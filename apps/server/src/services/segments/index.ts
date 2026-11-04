import type { MediaFile } from '../../db/schema.ts'
import type { AnalysisData, SkipSegment } from './model.ts'
import { stat } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { libraryFolders, mediaAnalysis, mediaFiles } from '../../db/schema.ts'
import { absolutePathOf } from '../library/files.ts'
import {
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
import { logFor } from '../logs/index.ts'
import { onPlaybackActivity, playbackActive } from './activity.ts'
import { consensus, match } from './match.ts'
import { ANALYSIS_VERSION, introWindow } from './model.ts'
import { credits, fingerprint } from './process.ts'

const pending = new Set<string>()
const deferred = new Set<string>()
const stages = {
  credits: 'credits scan (ffmpeg)',
  fingerprint: 'intro fingerprint (ffmpeg)',
  matching: 'intro matching',
}
type Stage = keyof typeof stages
let stage: Stage | 'waiting' = 'waiting'
let checking = false
let checked = 0
let hadWork = false
let enabled = false
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let running: Promise<void> | undefined
let unsubscribe: (() => void) | undefined
const IDLE_DELAY = 30_000

function queueProgress() {
  let remaining = pending.size
  for (const id of deferred) {
    if (!pending.has(id))
      remaining++
  }
  if (checking)
    remaining++
  return { checked, total: checked + remaining }
}

export function segmentAnalysisStatus() {
  if (!enabled || (!checking && !pending.size && !deferred.size))
    return null
  const currentStage: Stage | 'waiting' | 'paused'
    = playbackActive() || controller?.signal.aborted ? 'paused' : stage
  return { stage: currentStage, ...queueProgress() }
}

export function identity(file: MediaFile) {
  return JSON.stringify([
    ANALYSIS_VERSION,
    file.duration,
    file.titleId,
    file.season,
    file.episode,
    file.episodeTo,
    file.probe?.audio.map(track => [
      track.index,
      track.language,
      track.codec,
      track.default,
    ]),
  ])
}

export function eligible(file: MediaFile) {
  return (
    file.state === 'present'
    && file.matchStatus === 'matched'
    && !!file.titleId
    && !!file.probe?.video
    && Number.isFinite(file.duration)
    && file.duration! >= 120
  )
}

function source(id: string) {
  const row = getDb()
    .select({ file: mediaFiles, folder: libraryFolders })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(mediaFiles.folderId, libraryFolders.id))
    .where(eq(mediaFiles.id, id))
    .get()
  return row && row.folder.status === 'ok' && eligible(row.file)
    ? { ...row, path: absolutePathOf(row.folder, row.file) }
    : undefined
}

async function revision(path: string) {
  const info = await stat(path)
  if (!info.isFile())
    throw new Error('Media file unavailable')
  return `${info.size}:${info.mtimeMs}`
}

async function snapshot(id: string) {
  const found = source(id)
  if (!found)
    return undefined
  const key = await revision(found.path)
  // Probe and detector must describe the same bytes.
  if (found.file.probeKey !== key)
    return undefined
  return { ...found, revision: key, identity: identity(found.file) }
}

type Input = NonNullable<Awaited<ReturnType<typeof snapshot>>>
function cached(input: Input) {
  const row = getDb()
    .select()
    .from(mediaAnalysis)
    .where(eq(mediaAnalysis.fileId, input.file.id))
    .get()
  return row?.version === ANALYSIS_VERSION
    && row.revision === input.revision
    && row.identity === input.identity
    ? row.data
    : undefined
}

async function unchanged(input: Input) {
  const now = await snapshot(input.file.id).catch(() => undefined)
  return now?.revision === input.revision && now.identity === input.identity
}

async function save(input: Input, data: AnalysisData, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!(await unchanged(input)))
    return false
  signal.throwIfAborted()
  const values = {
    fileId: input.file.id,
    revision: input.revision,
    identity: input.identity,
    version: ANALYSIS_VERSION,
    data,
    updatedAt: new Date(),
  }
  getDb()
    .insert(mediaAnalysis)
    .values(values)
    .onConflictDoUpdate({ target: mediaAnalysis.fileId, set: values })
    .run()
  // Ready segments remain cheap; retain at most 200 bounded fingerprints (at most 5000 uint32 points each).
  const rows = getDb()
    .select()
    .from(mediaAnalysis)
    .orderBy(asc(mediaAnalysis.updatedAt))
    .all()
    .filter(row => row.data.fingerprint)
  for (const row of rows.slice(0, Math.max(0, rows.length - 200))) {
    getDb()
      .update(mediaAnalysis)
      .set({ data: { ...row.data, fingerprint: null } })
      .where(eq(mediaAnalysis.fileId, row.fileId))
      .run()
  }
  return true
}

function serialEpisode(file: MediaFile) {
  return (
    file.titleId?.startsWith('tmdb:tv:')
    && file.season !== null
    && file.episode !== null
    && (!file.episodeTo || file.episodeTo === file.episode)
  )
}

function neighbors(input: { file: MediaFile }) {
  if (!serialEpisode(input.file))
    return []
  const files = getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.titleId, input.file.titleId!),
        eq(mediaFiles.season, input.file.season!),
      ),
    )
    .all()
    .filter(
      file =>
        eligible(file)
        && serialEpisode(file)
        && file.episode !== input.file.episode,
    )
    .sort(
      (a, b) =>
        Math.abs(a.episode! - input.file.episode!)
        - Math.abs(b.episode! - input.file.episode!)
        || a.id.localeCompare(b.id),
    )
  const seen = new Set<number>()
  return files
    .filter((file) => {
      if (seen.has(file.episode!))
        return false
      seen.add(file.episode!)
      return true
    })
    .slice(0, 4)
}

type OnWork = (stage: Stage, mediaFileId: string) => void

async function audio(input: Input, signal: AbortSignal, onWork: OnWork) {
  const existing = cached(input)
  if (existing?.fingerprint)
    return existing
  const track
    = input.file.probe!.audio.find(track => track.default)
      ?? input.file.probe!.audio[0]
  const data: AnalysisData = {
    status: 'insufficient',
    fingerprint: null,
    audioTrack: track?.index ?? null,
    window: introWindow(input.file.duration!),
    visualDone: existing?.visualDone ?? false,
    segments:
      existing?.segments.filter(segment => segment.kind === 'credits') ?? [],
    references: [],
  }
  if (track) {
    onWork('fingerprint', input.file.id)
    data.fingerprint = await fingerprint(
      input.path,
      track.index,
      data.window,
      signal,
    )
  }
  else {
    data.status = 'unsupported'
  }
  await save(input, data, signal)
  return data
}

async function analyzeInput(input: Input, signal: AbortSignal, onWork: OnWork) {
  const id = input.file.id
  const existing = cached(input)
  const data: AnalysisData = existing
    ? {
        ...existing,
        segments: existing.segments.filter(
          segment => segment.kind === 'credits',
        ),
        references: [],
      }
    : {
        status: 'insufficient',
        visualDone: false,
        fingerprint: null,
        audioTrack: null,
        window: introWindow(input.file.duration!),
        segments: [],
        references: [],
      }
  // Visual results are immutable for a revision, including a successful empty result.
  if (!existing?.visualDone) {
    onWork('credits', id)
    data.segments = (
      await credits(input.path, input.file.duration!, signal)
    ).map((run, i) => ({
      id: `credits-${i}`,
      kind: 'credits',
      source: 'visual',
      ...run,
    }))
  }
  data.visualDone = true
  const inputs = [input]
  const cores: number[][] = []
  let ambiguous = false
  if (serialEpisode(input.file)) {
    try {
      const base = await audio(input, signal, onWork)
      data.fingerprint = base.fingerprint
      data.audioTrack = base.audioTrack
      for (const neighbor of neighbors(input)) {
        const other = await snapshot(neighbor.id)
        if (other)
          inputs.push(other)
      }
      const points = inputs.map(item => cached(item)?.fingerprint ?? null)
      points[0] = data.fingerprint
      for (let i = 1; i < inputs.length; i++) {
        if (!points[i])
          points[i] = (await audio(inputs[i], signal, onWork)).fingerprint
      }
      for (let i = 1; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          signal.throwIfAborted()
          if (!points[0] || !points[i] || !points[j])
            continue
          onWork('matching', id)
          const ab = match(points[0]!, points[i]!)
          await setImmediate()
          const ac = match(points[0]!, points[j]!)
          await setImmediate()
          const bc = match(points[i]!, points[j]!)
          await setImmediate()
          const core = consensus(ab, ac, bc)
          if (core === 'ambiguous')
            ambiguous = true
          else if (core)
            cores.push(core)
        }
      }
      if (
        !ambiguous
        && cores.length
        && cores.every(
          core =>
            Math.abs(core[0] - cores[0][0]) < 3
            && Math.abs(core[1] - cores[0][1]) < 3,
        )
      ) {
        data.segments.push({
          id: 'intro',
          kind: 'intro',
          source: 'audio',
          start: Math.max(...cores.map(core => core[0])),
          end: Math.min(...cores.map(core => core[1])),
        })
        data.references = inputs.slice(1).map(item => ({
          id: item.file.id,
          revision: item.revision,
          identity: item.identity,
        }))
      }
      data.status = !data.fingerprint
        ? 'unsupported'
        : inputs.length < 3
          ? 'insufficient'
          : 'no-match'
    }
    catch (err) {
      if (signal.aborted)
        throw err
      // Audio tooling failure cannot disable independently confirmed credits or playback.
      data.status = 'error'
      logFor('storage').warn({ mediaFileId: id }, 'Intro analysis unavailable')
    }
  }
  else {
    data.status = 'unsupported'
  }
  data.audioStatus = data.status
  for (const item of inputs) {
    if (!(await unchanged(item)))
      return
  }
  if (data.segments.length)
    data.status = 'ready'
  if (await save(input, data, signal))
    return data
}

async function analyze(id: string, signal: AbortSignal) {
  const input = await snapshot(id)
  if (!input)
    return
  let started = 0
  let progress: ReturnType<typeof setInterval> | undefined
  let stageFileId: string
  const context = () => ({
    mediaFileId: id,
    stage,
    stageFileId,
    ...queueProgress(),
    elapsedMs: Math.round(performance.now() - started),
  })
  const onWork: OnWork = (nextStage, fileId) => {
    signal.throwIfAborted()
    stage = nextStage
    stageFileId = fileId
    if (progress)
      return
    started = performance.now()
    hadWork = true
    logFor('storage').info(
      context(),
      `Intro/credits analysis started: ${stages[nextStage]}`,
    )
    progress = setInterval(() => {
      if (!signal.aborted && stage !== 'waiting') {
        const fields = context()
        logFor('storage').info(
          fields,
          `Intro/credits analysis in progress: ${stages[stage]}, ${fields.checked}/${fields.total} files checked`,
        )
      }
    }, 30_000)
    progress.unref()
  }
  try {
    const result = await analyzeInput(input, signal, onWork)
    if (progress) {
      const fields = context()
      fields.checked++
      logFor('storage').info(
        {
          ...fields,
          status: result?.status,
          audioStatus: result?.audioStatus,
          segments: result?.segments.length,
        },
        result
          ? `Intro/credits analysis finished: ${fields.checked}/${fields.total} files checked, segments found: ${result.segments.length}`
          : 'Intro/credits analysis discarded: input changed',
      )
    }
  }
  catch (err) {
    if (progress && signal.aborted) {
      logFor('storage').info(
        context(),
        enabled
          ? 'Intro/credits analysis paused for playback; file will be retried'
          : 'Intro/credits analysis stopped for shutdown',
      )
    }
    const previous = cached(input)
    const data: AnalysisData = previous ?? {
      status: 'error',
      visualDone: false,
      fingerprint: null,
      audioTrack: null,
      window: introWindow(input.file.duration!),
      segments: [],
      references: [],
    }
    await save(
      input,
      { ...data, status: signal.aborted ? 'cancelled' : 'error' },
      new AbortController().signal,
    )
    throw err
  }
  finally {
    clearInterval(progress)
  }
}

/** Only ready data for current bytes and identity. Never starts analysis. */
export async function readySegments(id: string): Promise<SkipSegment[]> {
  try {
    const input = await snapshot(id)
    if (!input)
      return []
    const data = cached(input)
    if (!data)
      return []
    let segments = data.segments.filter(
      segment =>
        Number.isFinite(segment.start)
        && Number.isFinite(segment.end)
        && segment.start >= 0
        && segment.end > segment.start
        && segment.end < input.file.duration!,
    )
    for (const ref of data.references) {
      const other = await snapshot(ref.id).catch(() => undefined)
      if (other?.revision !== ref.revision || other.identity !== ref.identity) {
        segments = segments.filter(segment => segment.kind !== 'intro')
        break
      }
    }
    return segments
  }
  catch {
    return []
  }
}

function schedule() {
  clearTimeout(timer)
  if (!enabled || playbackActive() || running || !pending.size)
    return
  timer = setTimeout(() => {
    timer = undefined
    controller = new AbortController()
    const signal = controller.signal
    running = (async () => {
      while (!signal.aborted && !playbackActive() && pending.size) {
        const id = pending.values().next().value!
        pending.delete(id)
        deferred.delete(id)
        checking = true
        try {
          await withMaintenanceLease({ mediaFileId: id, producer: true }, () =>
            analyze(id, signal))
        }
        catch (error) {
          if (signal.aborted) {
            pending.add(id)
            break
          }
          if (error instanceof MaintenanceBusyError) {
            deferred.add(id)
            continue
          }
          logFor('storage').warn(
            { mediaFileId: id },
            'Intro/credits analysis failed',
          )
        }
        finally {
          checking = false
          stage = 'waiting'
        }
        checked++
      }
      for (const id of deferred) pending.add(id)
      deferred.clear()
      if (!pending.size) {
        if (hadWork && enabled) {
          logFor('storage').info(
            queueProgress(),
            `Intro/credits analysis queue finished: ${checked} files checked`,
          )
        }
        checked = 0
        hadWork = false
      }
    })().finally(() => {
      running = undefined
      controller = undefined
      schedule()
    })
  }, IDLE_DELAY)
  timer.unref()
}

export function queueAnalysis(id: string) {
  if (!enabled)
    return
  pending.add(id)
  const input = source(id)
  if (input && serialEpisode(input.file)) {
    // Retry every version too: versions are not independent consensus votes,
    // but each still needs its own boundaries after a third episode arrives.
    const season = getDb()
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.titleId, input.file.titleId!),
          eq(mediaFiles.season, input.file.season!),
        ),
      )
      .all()
    for (const file of season) pending.add(file.id)
  }
  schedule()
}

export function startAnalysis() {
  if (enabled)
    return
  enabled = true
  unsubscribe = onPlaybackActivity(() => {
    if (playbackActive())
      controller?.abort()
    schedule()
  })
}

export async function stopAnalysis() {
  enabled = false
  clearTimeout(timer)
  unsubscribe?.()
  unsubscribe = undefined
  pending.clear()
  controller?.abort()
  await running
  pending.clear()
  checked = 0
  hadWork = false
}
