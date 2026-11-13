import { z } from 'zod'

// IDs only, never labels, paths, query text or URLs.
export const diagnosticId = z.string().regex(/^[\w-]{8,80}$/)
export const diagnosticTitleId = z
  .string()
  .regex(/^tmdb:(?:tv|movie):[1-9]\d{0,12}$/)
export const diagnosticCandidateId = z.string().regex(/^[a-f0-9]{16,64}$/i)
const count = z.number().int().min(0).max(1_000_000)
const seconds = z.number().min(0).max(31_536_000)
const episode = z.number().int().min(0).max(9999)
const resolution = z.strictObject({
  value: z.enum(['2160p', '1080p', '720p', 'SD']),
  basis: z.enum(['probe', 'file', 'title', 'source', 'codec']),
  sure: z.boolean(),
})
export const candidateDiagnostics = z
  .strictObject({
    rank: count,
    decisiveKey: z
      .enum([
        'no_comparison',
        'confidence',
        'audioPriority',
        'typePriority',
        'score',
        'seeders',
        'id',
      ])
      .optional(),
    score: z.number().min(-1e9).max(1e9),
    audioPriority: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    typePriority: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .meta({ id: 'candidateDiagnostics' })
const candidate = z.strictObject({
  candidateId: diagnosticCandidateId,
  diagnostics: candidateDiagnostics.optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  seeders: count,
  quality: z
    .enum(['2160p', '1440p', '1080p', '1080i', '720p', '576p', '480p', '360p'])
    .nullable(),
  resolution: resolution.nullable(),
  coversEpisode: z.boolean(),
})
const target = {
  titleId: diagnosticTitleId.optional(),
  season: episode.optional(),
  episode: episode.optional(),
  torrentId: diagnosticId.optional(),
  fileIndex: count.optional(),
  mediaFileId: diagnosticId.optional(),
  session: diagnosticId.optional(),
}
const common = {
  eventId: z.string().regex(/^[\w-]{8,80}:\d{1,12}$/),
  clientSessionId: diagnosticId,
  clientSeq: z.number().int().min(1).max(999_999_999_999),
  clientTime: z.string().datetime(),
  elapsedMs: z.number().min(0).max(31_536_000_000),
  actionId: diagnosticId.optional(),
  parentActionId: diagnosticId.optional(),
  clientRequestId: diagnosticId.optional(),
  pollId: diagnosticId.optional(),
  requestId: diagnosticId.optional(),
  decisionId: diagnosticId.optional(),
  rankingDecisionId: diagnosticId.optional(),
  generation: count.optional(),
  ...target,
}
const route = z.enum([
  'home',
  'title',
  'resolve',
  'player',
  'sources',
  'files',
  'library',
  'profile',
  'other',
])
const outcome = z.enum([
  'accepted',
  'failed',
  'stale',
  'cancelled',
  'unknown',
  'http_error',
  'network_error',
  'timeout',
])
const supportCommon = {
  eventId: common.eventId,
  clientSessionId: common.clientSessionId,
  clientSeq: common.clientSeq,
  clientTime: common.clientTime,
  elapsedMs: common.elapsedMs,
  actionId: common.actionId,
  parentActionId: common.parentActionId,
  clientRequestId: common.clientRequestId,
  requestId: common.requestId,
  session: common.session,
}

// Optional negotiated support facts. No free text, URLs, track labels or raw UA.
const supportVersion = z.string().regex(/^\d{1,4}(?:\.\d{1,4}){0,3}$/)
const supportLocation = z.strictObject({
  assetId: z.string().regex(/^[a-f0-9]{64}$/),
  line: z.number().int().min(1).max(10_000_000),
  column: z.number().int().min(0).max(10_000_000),
})
export const diagnosticMediaSnapshot = z
  .strictObject({
    state: z.enum(['available', 'unsupported', 'unknown']),
    source: z.enum(['html_video', 'native']),
    position: seconds.optional(),
    duration: seconds.optional(),
    paused: z.boolean().optional(),
    ended: z.boolean().optional(),
    seeking: z.boolean().optional(),
    readyState: z.number().int().min(0).max(4).optional(),
    networkState: z.number().int().min(0).max(3).optional(),
    buffered: z
      .array(z.strictObject({ start: seconds, end: seconds }))
      .max(4)
      .optional(),
    width: z.number().int().min(0).max(16384).optional(),
    height: z.number().int().min(0).max(16384).optional(),
    droppedFrames: count.optional(),
    totalFrames: count.optional(),
    audioTrack: z.number().int().min(-1).max(1000).optional(),
    subtitleTrack: z.number().int().min(-1).max(1000).optional(),
    audioCodec: z
      .enum([
        'aac',
        'ac3',
        'eac3',
        'dts',
        'truehd',
        'mp3',
        'flac',
        'opus',
        'vorbis',
        'pcm',
        'unknown',
      ])
      .optional(),
    audioLanguage: z
      .enum([
        'en',
        'ru',
        'de',
        'fr',
        'es',
        'it',
        'pt',
        'ja',
        'ko',
        'zh',
        'uk',
        'und',
        'unknown',
      ])
      .optional(),
    mode: z.enum(['direct', 'hls', 'unknown']).optional(),
    video: z.enum(['copy', 'encode']).optional(),
    audio: z.enum(['copy', 'aac']).optional(),
    reasons: z
      .array(
        z.enum([
          'ContainerNotSupported',
          'VideoCodecNotSupported',
          'VideoBitDepthNotSupported',
          'AudioCodecNotSupported',
          'AudioTrackSwitchNotSupported',
          'SubtitleCodecNotSupported',
          'HlsNotSupported',
          'ToolsMissing',
          'ProbeFailed',
          'DurationUnknown',
        ]),
      )
      .max(10)
      .optional(),
    hls: z
      .enum([
        'unsupported',
        'idle',
        'loading',
        'playing',
        'recovering',
        'error',
        'unknown',
      ])
      .optional(),
    native: z
      .enum([
        'unsupported',
        'idle',
        'loading',
        'playing',
        'paused',
        'buffering',
        'ended',
        'error',
        'unknown',
      ])
      .optional(),
  })
  .meta({ id: 'diagnosticMediaSnapshot' })
// A client observation of the last stats response, not a server/engine measurement.
// Bytes and bytes/s are unscaled; engine seconds use the file's average bitrate.
export const diagnosticPlaybackNetwork = z
  .strictObject({
    torrentId: diagnosticId.optional(),
    fileIndex: count.optional(),
    stats: z.strictObject({
      state: z.enum([
        'fresh',
        'stale',
        'error',
        'unavailable',
        'not_applicable',
      ]),
      ageMs: z.number().min(0).max(31_536_000_000).optional(),
      offsetBytes: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      downloadBytesPerSecond: z
        .number()
        .min(0)
        .max(1_000_000_000_000)
        .optional(),
      peersConnected: count.optional(),
      seedersConnected: count.optional(),
      peersFound: count.optional(),
      bufferedAheadBytes: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      estimatedBufferedAheadSeconds: seconds.optional(),
    }),
    clientBuffer: z.strictObject({
      state: z.enum(['available', 'unknown', 'unsupported']),
      aheadSeconds: seconds.optional(),
    }),
  })
  .meta({ id: 'diagnosticPlaybackNetwork' })
export const diagnosticEvent = z
  .discriminatedUnion('event', [
    z.strictObject({
      ...supportCommon,
      event: z.literal('client.environment'),
      tvBuildId: z.string().regex(/^[\w.-]{1,80}$/),
      clientKind: z.enum(['browser', 'webos', 'android']),
      shellVersion: z
        .string()
        .regex(/^[\w.-]{1,40}$/)
        .optional(),
      browserFamily: z.enum(['chromium', 'firefox', 'safari', 'unknown']),
      browserVersion: supportVersion.optional(),
      osFamily: z.enum([
        'webos',
        'android',
        'windows',
        'macos',
        'linux',
        'ios',
        'unknown',
      ]),
      osVersion: supportVersion.optional(),
      deviceModel: z.literal('unsupported'),
      assetManifest: z.enum(['available', 'unavailable']),
      autoNext: z.boolean().optional(),
      maxHeight: z.number().int().min(0).max(16384).optional(),
      maxBitrate: z.number().int().min(0).max(1_000_000_000).optional(),
      playerMode: z.enum(['browser', 'native', 'auto']).optional(),
    }),
    z.strictObject({
      ...supportCommon,
      event: z.literal('client.error'),
      tvBuildId: z.string().regex(/^[\w.-]{1,80}$/),
      source: z.enum(['runtime', 'promise', 'media', 'hls', 'native']),
      code: z.enum([
        'unknown',
        'type_error',
        'range_error',
        'reference_error',
        'syntax_error',
        'uri_error',
        'eval_error',
        'abort_error',
        'network_error',
        'not_allowed',
        'not_supported',
        'media_aborted',
        'media_network',
        'media_decode',
        'media_source',
        'hls_network',
        'hls_media',
        'hls_mux',
        'hls_other',
        'native_playback',
      ]),
      locations: z.array(supportLocation).max(4),
      droppedLocations: count,
      media: diagnosticMediaSnapshot.optional(),
    }),
    z.strictObject({
      ...supportCommon,
      event: z.literal('client.error_summary'),
      suppressed: count,
      reason: z.enum(['rate_limit', 'deduplicated', 'mixed']),
    }),
    z.strictObject({
      ...supportCommon,
      event: z.literal('playback.snapshot'),
      trigger: z.enum(['transition', 'buffering', 'heartbeat', 'error']),
      media: diagnosticMediaSnapshot,
      network: diagnosticPlaybackNetwork.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('client.started'),
      tvBuildId: z.string().regex(/^[\w.-]{1,80}$/),
      clientKind: z.enum(['browser', 'webos', 'android']),
      shellVersion: z
        .string()
        .regex(/^[\w.-]{1,40}$/)
        .optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('navigation.completed'),
      route,
      previousRoute: route.optional(),
      method: z.enum(['push', 'replace', 'back']),
      trigger: z.enum(['remote', 'pointer', 'automatic', 'back']),
    }),
    z.strictObject({
      ...common,
      event: z.literal('selection.activated'),
      slot: z.enum([
        'continue',
        'title',
        'episode',
        'source',
        'libraryVersion',
      ]),
      trigger: z.enum(['remote', 'pointer', 'automatic']),
      candidateId: diagnosticCandidateId.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.enum(['continue.presented', 'continue.selected']),
      position: seconds,
      duration: seconds.nullable(),
      next: z.boolean(),
      followNewEpisode: z.boolean(),
      snapshotAgeMs: count,
    }),
    z.strictObject({
      ...common,
      event: z.literal('continue.refresh'),
      outcome,
      retained: z.boolean(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('continue.route'),
      branch: z.enum([
        'direct_file',
        'library_lookup',
        'library_single',
        'library_picker',
        'downloaded_file',
        'previous_file',
        'resolve',
        'sources',
      ]),
      outcome: outcome.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('upnext.received'),
      outcome,
      available: z.boolean(),
    }),
    z.strictObject({
      ...common,
      event: z.enum([
        'upnext.visibility',
        'upnext.selected',
        'upnext.dismissed',
      ]),
      available: z.boolean(),
      displayed: z.boolean(),
      gate: z.enum([
        'no_target',
        'no_sources_or_library',
        'before_threshold',
        'duration_unknown',
        'panel',
        'restarting',
        'error',
        'not_playing',
        'credits',
        'remaining',
        'dismissed',
        'ended',
      ]),
      position: seconds.optional(),
      duration: seconds.optional(),
      remaining: seconds.optional(),
      thresholdSeconds: seconds.optional(),
      countdownSeconds: seconds.optional(),
      summary: z.boolean().optional(),
      everDisplayed: z.boolean().optional(),
      autoNext: z.boolean().optional(),
      trigger: z
        .enum(['remote', 'pointer', 'countdown', 'ended', 'OSD_next', 'exit'])
        .optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('player.back'),
      outcome: z.enum([
        'wake_osd',
        'settings_step',
        'close_panel',
        'hide_osd',
        'dismiss_skip',
        'dismiss_upnext',
        'exit',
      ]),
      position: seconds.optional(),
      remaining: seconds.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('library.choice'),
      outcome: z.enum(['auto_single', 'selected', 'cancelled', 'deactivated']),
      versions: count,
    }),
    z.strictObject({
      ...common,
      event: z.enum(['source.resolve', 'source.attempt', 'source.selected']),
      branch: z.enum([
        'requested',
        'known_torrent',
        'follow_pick',
        'ranked_candidate',
      ]),
      outcome: z.enum([
        'ready',
        'resolving',
        'file_found',
        'episode_absent',
        'metadata_timeout',
        'open_rejected',
        'search_failed',
        'cancelled',
        'stale',
      ]),
      presetId: diagnosticId.optional(),
      candidateId: diagnosticCandidateId.optional(),
      attemptIndex: z.number().int().min(0).max(3).optional(),
      candidates: z.array(candidate).max(3).optional(),
      found: count.optional(),
      eligible: count.optional(),
      rankingApplied: z.boolean().optional(),
    }),
    z.strictObject({
      ...common,
      event: z.enum([
        'playback.requested',
        'playback.ready',
        'playback.playing',
        'playback.retry',
        'playback.error',
        'playback.closed',
      ]),
      mode: z.enum(['direct', 'remux', 'transcode']).optional(),
      outcome: outcome.optional(),
      position: seconds.optional(),
      width: count.optional(),
      height: count.optional(),
      previousSession: diagnosticId.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.enum(['progress.requested', 'progress.result']),
      outcome,
      position: seconds,
      duration: seconds.nullable(),
      reason: z.enum(['exit', 'next', 'source_switch', 'pause', 'checkpoint']),
    }),
    z.strictObject({
      ...common,
      event: z.enum(['operation.cancelled', 'operation.stale']),
      reason: z.enum([
        'superseded',
        'back',
        'profile_changed',
        'deactivated',
        'user_interaction',
        'unmounted',
        'timeout',
      ]),
      applied: z.boolean().optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('poll.summary'),
      pollId: diagnosticId,
      kind: z.enum(['files', 'probe']),
      outcome,
      observationsComplete: z.boolean(),
      incompleteReason: z
        .enum(['ttl', 'capacity', 'not_instrumented'])
        .optional(),
      requests: count,
      attempts: count,
      errors: count,
      durationMs: count,
      firstRequestId: diagnosticId.optional(),
      lastRequestId: diagnosticId.optional(),
      errorRequestId: diagnosticId.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('request.result'),
      outcome,
      attempt: count,
      statusCode: z.number().int().min(100).max(599).optional(),
      durationMs: count,
    }),
    z.strictObject({
      ...common,
      event: z.literal('continuation.consent'),
      outcome: z.enum([
        'detected',
        'accepted',
        'sources',
        'exit',
        'stale',
        'unknown',
        'same_file',
        'manual',
        'not_lower',
        'cancelled',
        'quality_checked',
        'opened',
      ]),
      baselineHeight: count.optional(),
      candidateHeight: count.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('playback.buffering'),
      state: z.enum(['started', 'ended', 'summary']),
      durationMs: count.optional(),
      count: count.optional(),
    }),
    z.strictObject({
      ...common,
      event: z.literal('playback.seek'),
      from: seconds,
      to: seconds,
      trigger: z.enum(['remote', 'pointer', 'automatic']),
    }),
    z.strictObject({
      ...common,
      event: z.literal('player.summary'),
      position: seconds.optional(),
      duration: seconds.optional(),
      upnextAvailable: z.boolean(),
      upnextDisplayed: z.boolean(),
      bufferingMs: count,
      bufferingCount: count,
      reason: z.enum(['exit', 'next', 'source_switch', 'unmounted', 'error']),
    }),
    z.strictObject({
      ...common,
      event: z.literal('diagnostics.loss'),
      reason: z.enum([
        'overflow',
        'expiry',
        'auth',
        'storage',
        'rate_limit',
        'invalid_event',
      ]),
      count,
      fromSeq: count.optional(),
      toSeq: count.optional(),
    }),
  ])
  .meta({ id: 'diagnosticEvent' })

export const diagnosticBatch = z
  .strictObject({
    schemaVersion: z.literal(1),
    deviceId: diagnosticId.nullable(),
    profileId: diagnosticId,
    events: z.array(diagnosticEvent).min(1).max(16),
  })
  .meta({ id: 'diagnosticBatch' })
export const diagnosticStatus = z
  .object({
    enabled: z.boolean(),
    collecting: z.boolean(),
    supportFacts: z.literal(1).optional(),
    playbackNetwork: z.literal(1).optional(),
    schemaVersion: z.literal(1),
    serverVersion: z.string(),
    serverInstance: z.string(),
    serverTime: z.string(),
    deviceId: z.string().nullable(),
    profileId: z.string(),
    fileSinkState: z.enum(['enabled', 'disabled']),
    retentionState: z.enum(['ok', 'degraded']),
  })
  .meta({ id: 'diagnosticStatus' })
export const diagnosticAck = z
  .object({
    accepted: z.array(z.string()),
    duplicate: z.array(z.string()),
    rejected: z.array(
      z.object({
        eventId: z.string(),
        code: z.enum([
          'disabled',
          'level_filtered',
          'invalid_event',
          'journal_unavailable',
        ]),
      }),
    ),
    serverInstance: z.string(),
    fileSinkState: z.enum(['enabled', 'disabled']),
  })
  .meta({ id: 'diagnosticAck' })
export const diagnosticSettings = z
  .strictObject({ enabled: z.boolean() })
  .meta({ id: 'diagnosticSettings' })
export type DiagnosticEvent = z.infer<typeof diagnosticEvent>
export type DiagnosticBatch = z.infer<typeof diagnosticBatch>
export type DiagnosticAck = z.infer<typeof diagnosticAck>
