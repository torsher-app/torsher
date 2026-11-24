import type { SubtitleLanguage } from './languages.ts'
import type { SubtitleTarget } from './target.ts'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { and, eq, lte } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { subtitleJobs } from '../../db/schema.ts'
import { getMediaFile } from '../library/files.ts'
import {
  libraryProbeKey,
  storedProbeMatches,
} from '../library/playedSource.ts'
import {
  assertMaintenanceMutation,
  MaintenanceBusyError,
  withMaintenanceLease,
} from '../libraryMaintenance/admission.ts'
import {
  downloadedSubtitlesOf,
  ownedManagedSubtitleNames,
  pruneTorrentSubtitles,
  reconcilePrivateSubtitleStorage,
  registerDownloadedSubtitle,
} from '../media/downloadedSubtitles.ts'
import { activeDownloadedSubtitleIds } from '../media/sessions.ts'
import { librarySubtitles } from '../media/subtitles.ts'
import { subtitleLanguage } from './languages.ts'
import { providerError } from './providerHttp.ts'
import {
  currentProviderCredentials,
  downloadCandidate,
  providerSearch,
} from './providers.ts'
import { getSubtitleConfig, openSubtitlesConfigured } from './settings.ts'
import {
  openSubtitlesHash,
  sameSubtitleTarget,
  subtitleTargetOfLibrary,
} from './target.ts'

type Job = typeof subtitleJobs.$inferSelect
const MINUTE = 60_000
const MAX_ATTEMPTS = 6
let busy = false
let lastPruned = 0

export function enqueueSubtitlesForNewFile(
  mediaFileId: string,
  sourceRevision: string,
) {
  const config = getSubtitleConfig()
  const { autoDownload, languages } = config.openSubtitles
  if (!autoDownload || !languages.length || !openSubtitlesConfigured(config))
    return

  getDb()
    .insert(subtitleJobs)
    .values(
      languages.map(language => ({
        mediaFileId,
        sourceRevision,
        language,
        // Даём линкеру закончить размещение доступных штатных sidecar.
        nextAt: new Date(Date.now() + MINUTE),
      })),
    )
    .onConflictDoNothing()
    .run()
}

function jobKey(job: Job) {
  return and(
    eq(subtitleJobs.mediaFileId, job.mediaFileId),
    eq(subtitleJobs.sourceRevision, job.sourceRevision),
    eq(subtitleJobs.language, job.language),
    eq(subtitleJobs.state, 'queued'),
  )
}

function finish(job: Job) {
  getDb().update(subtitleJobs).set({ state: 'done' }).where(jobKey(job)).run()
}

function defer(job: Job, delayMs: number, counted: boolean) {
  const attempts = job.attempts + Number(counted)
  getDb()
    .update(subtitleJobs)
    .set({
      attempts,
      state: attempts >= MAX_ATTEMPTS ? 'done' : 'queued',
      nextAt: new Date(Date.now() + delayMs),
    })
    .where(jobKey(job))
    .run()
}

async function existingSubtitle(
  job: Job,
  target: SubtitleTarget,
  language: SubtitleLanguage,
) {
  const library = target.library!
  const found = getMediaFile(library.id)
  if (
    found?.file.probe?.subtitles.some(
      track =>
        track.text
        && !track.forced
        && subtitleLanguage(track.language) === language,
    )
  ) {
    return true
  }
  const owned = ownedManagedSubtitleNames(library.id)
  const names = await readdir(dirname(library.path))
  if (
    librarySubtitles(basename(library.path), names).some(
      track =>
        !owned.has(track.path)
        && !track.forced
        && subtitleLanguage(track.language) === language,
    )
  ) {
    return true
  }
  return (await downloadedSubtitlesOf(job.sourceRevision, false)).some(
    track => !track.forced && subtitleLanguage(track.language) === language,
  )
}

async function processSubtitleJob(job: Job) {
  const config = getSubtitleConfig()
  const language = subtitleLanguage(job.language)
  if (!language || !config.openSubtitles.languages.includes(language)) {
    finish(job)
    return
  }
  const found = getMediaFile(job.mediaFileId)
  const target = found && subtitleTargetOfLibrary(found)
  if (!found || !target?.library?.managed) {
    finish(job)
    return
  }
  const info = await stat(found.path).catch(() => undefined)
  if (
    !info?.isFile()
    || libraryProbeKey(found.file.id, info) !== job.sourceRevision
  ) {
    finish(job)
    return
  }
  if (!storedProbeMatches(found.file, info) || !found.file.probe) {
    defer(job, 5 * MINUTE, true)
    return
  }

  if (await existingSubtitle(job, target, language)) {
    finish(job)
    return
  }

  const credentials = currentProviderCredentials('opensubtitles')
  if (!credentials) {
    defer(job, 15 * MINUTE, false)
    return
  }
  const current = async () => {
    const file = getMediaFile(job.mediaFileId)
    if (!file || !sameSubtitleTarget(target, subtitleTargetOfLibrary(file)))
      return false
    const now = await stat(file.path).catch(() => undefined)
    if (
      !now?.isFile()
      || libraryProbeKey(file.file.id, now) !== job.sourceRevision
      || !storedProbeMatches(file.file, now)
      || (await existingSubtitle(job, target, language))
    ) {
      return false
    }
    const live = getSubtitleConfig().openSubtitles
    return (
      live.autoDownload
      && live.languages.includes(language)
      && live.revision === credentials.revision
      && !!getDb()
        .select({ state: subtitleJobs.state })
        .from(subtitleJobs)
        .where(jobKey(job))
        .get()
    )
  }

  const hash = await openSubtitlesHash(target.hashPath)
  if (!(await current())) {
    defer(job, 5 * MINUTE, true)
    return
  }
  const resource = { mediaFileId: job.mediaFileId, producer: true }
  assertMaintenanceMutation(resource)
  const foundSubtitles = await providerSearch(
    'opensubtitles',
    credentials,
    target,
    language,
    hash,
  )
  const matching = foundSubtitles.filter(
    result => !result.forced && result.match !== 'title',
  )
  // При нескольких равных точных вариантах не выбираем монтаж вслепую.
  const unique = (items: typeof matching) => [
    ...new Map(items.map(item => [item.remoteId, item])).values(),
  ]
  const hashes = unique(matching.filter(result => result.match === 'hash'))
  const strongest = hashes.length ? hashes : unique(matching)
  const candidate = strongest.length === 1 ? strongest[0] : undefined
  if (!candidate) {
    finish(job)
    return
  }

  const download = downloadCandidate({
    candidate,
    credentials,
    sourceRevision: job.sourceRevision,
    current,
    automatic: true,
  })
  try {
    const bytes = await download.bytes
    await withMaintenanceLease(resource, () =>
      registerDownloadedSubtitle(
        job.sourceRevision,
        {
          language,
          title: candidate.release,
          forced: false,
          ownerOnly: false,
        },
        bytes,
        {
          provider: 'opensubtitles',
          providerFile: candidate.remoteId,
          hearingImpaired: candidate.hearingImpaired,
          library: target.library,
          canPublish: current,
          activeIds: activeDownloadedSubtitleIds,
        },
      ))
  }
  finally {
    download.release()
  }
  finish(job)
}

/** Один короткий проход с отдельным ограничением времени и квоты провайдера. */
export async function runSubtitleJobs() {
  if (busy)
    return
  busy = true
  try {
    if (Date.now() - lastPruned > 60 * MINUTE) {
      pruneTorrentSubtitles(activeDownloadedSubtitleIds())
      reconcilePrivateSubtitleStorage()
      lastPruned = Date.now()
    }
    const config = getSubtitleConfig()
    if (!openSubtitlesConfigured(config) || !config.openSubtitles.autoDownload)
      return
    const jobs = getDb()
      .select()
      .from(subtitleJobs)
      .where(
        and(
          eq(subtitleJobs.state, 'queued'),
          lte(subtitleJobs.nextAt, new Date()),
        ),
      )
      .orderBy(subtitleJobs.nextAt)
      .limit(3)
      .all()
    for (const job of jobs) {
      try {
        await processSubtitleJob(job)
      }
      catch (error) {
        if (error instanceof MaintenanceBusyError) {
          defer(job, 5 * MINUTE, false)
          continue
        }
        const issue = providerError(error)
        if (issue.kind === 'quota') {
          const reset = issue.resetAt
            ? Date.parse(issue.resetAt)
            : Date.now() + 15 * MINUTE
          defer(job, Math.max(reset - Date.now(), MINUTE), false)
        }
        else {
          defer(job, Math.min(60, 2 ** job.attempts * 5) * MINUTE, true)
        }
      }
    }
  }
  finally {
    busy = false
  }
}
