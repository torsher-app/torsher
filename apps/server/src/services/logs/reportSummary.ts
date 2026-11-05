import type { ReportEvent } from './reportProjection.ts'

interface Observation {
  observedAt: string
  event: string
  origin: 'client' | 'server'
  source: 'disk' | 'ring'
  requestId?: string
  ingestRequestId?: string
  reportedRequestId?: string
  session?: string
  reportedSession?: string
  sessionBinding?: string
  actionId?: string
  decisionId?: string
  reason?: string
  outcome?: string
  code?: string
  failureSource?: string
  suppressed?: number
  suppressionReason?: string
  windowStartedAt?: string
  windowEndedAt?: string
}
interface VersionFact {
  value: string
  source: 'disk' | 'ring'
  clientSessionId?: string
  observedAt: string
  origin: 'client' | 'server'
  serverInstance?: string
}
interface Session {
  id: string
  actor: string
  firstServerObservedAt: string
  lastServerObservedAt: string
  hasClientEvents: boolean
  hasServerPlayback: boolean
  terminalObserved: boolean
  sources: Set<'disk' | 'ring'>
  instances: Set<string>
  instancesTruncated: boolean
  versionFacts: Record<string, VersionFact>
  observations: Observation[]
  seqs: Set<string>
  seqTruncated: boolean
  explicitLossRecords: number
  actionIds: Set<string>
  parents: Set<string>
  contextTruncated: boolean
}

function text(value: unknown) {
  return typeof value === 'string' ? value : undefined
}
function actorOf(facts: ReportEvent['facts']) {
  if (typeof facts.profileId !== 'string')
    return undefined
  // These are server-authenticated fields, never diagnostic payload fields.
  // A profile alone is not a join: aliases also require a client/playback ID.
  return JSON.stringify([
    facts.actorKind ?? 'unknown',
    facts.deviceId ?? null,
    facts.profileId,
  ])
}
function newer(a: VersionFact, b: VersionFact) {
  return (
    a.observedAt > b.observedAt
    || (a.observedAt === b.observedAt && a.value > b.value)
  )
}
function order(a: Observation, b: Observation) {
  return (
    b.observedAt.localeCompare(a.observedAt)
    || a.event.localeCompare(b.event)
    || (a.requestId ?? a.reportedRequestId ?? '').localeCompare(
      b.requestId ?? b.reportedRequestId ?? '',
    )
  )
}
function observationOf(
  event: ReportEvent,
  source: 'disk' | 'ring',
): Observation {
  const { facts, diagnostic, origin, observedAt } = event
  const observation: Observation = {
    observedAt,
    event: event.event,
    origin,
    source,
  }
  if (origin === 'client') {
    observation.ingestRequestId = text(facts.requestId)
    observation.reportedRequestId
      = diagnostic?.requestId ?? text(facts.reportedRequestId)
    observation.reportedSession
      = diagnostic?.session ?? text(facts.reportedSession)
    observation.sessionBinding = text(facts.sessionBinding)
    if (facts.sessionBinding === 'owned')
      observation.session = text(facts.session)
  }
  else {
    observation.requestId = text(facts.requestId)
    observation.session = text(facts.session)
    observation.reportedSession = text(facts.reportedSession)
  }
  for (const key of [
    'actionId',
    'decisionId',
    'reason',
    'outcome',
    'code',
  ] as const) {
    const value
      = origin === 'client'
        ? (diagnostic as unknown as Record<string, unknown> | undefined)?.[key]
        : facts[key]
    if (typeof value === 'string')
      observation[key] = value
  }
  observation.code ??= text(facts.failureCode)
  observation.failureSource = text(facts.failureSource)
  if (event.event === 'server.failure_summary') {
    observation.suppressed
      = typeof facts.suppressed === 'number' ? facts.suppressed : undefined
    observation.suppressionReason = text(facts.suppressionReason)
    observation.windowStartedAt = text(facts.windowStartedAt)
    observation.windowEndedAt = text(facts.windowEndedAt)
  }
  return observation
}

/** 64 groups, 1024 aliases, 128 sequences and 64 context IDs per group. */
export class ReportSummary {
  private sessions = new Set<Session>()
  private aliases = new Map<string, Session>()
  private oldest: string | null = null
  private newest: string | null = null
  private truncated = false
  private unboundRecords = 0
  private records = 0
  private errors: Observation[] = []

  private union<T>(target: Set<T>, values: Set<T>, limit: number) {
    let truncated = false
    for (const value of values) {
      if (target.has(value))
        continue
      if (target.size < limit)
        target.add(value)
      else truncated = true
    }
    return truncated
  }

  private merge(target: Session, other: Session) {
    if (target === other)
      return
    target.firstServerObservedAt = [
      target.firstServerObservedAt,
      other.firstServerObservedAt,
    ].sort()[0]!
    target.lastServerObservedAt = [
      target.lastServerObservedAt,
      other.lastServerObservedAt,
    ].sort()[1]!
    target.hasClientEvents ||= other.hasClientEvents
    target.hasServerPlayback ||= other.hasServerPlayback
    target.terminalObserved ||= other.terminalObserved
    this.union(target.sources, other.sources, 2)
    target.instancesTruncated
      = this.union(target.instances, other.instances, 8)
        || target.instancesTruncated
        || other.instancesTruncated
    this.truncated ||= target.instancesTruncated
    target.seqTruncated
      = this.union(target.seqs, other.seqs, 128)
        || target.seqTruncated
        || other.seqTruncated
    target.contextTruncated
      = this.union(target.actionIds, other.actionIds, 64)
        || target.contextTruncated
        || other.contextTruncated
    target.contextTruncated
      = this.union(target.parents, other.parents, 64) || target.contextTruncated
    target.explicitLossRecords += other.explicitLossRecords
    for (const [key, value] of Object.entries(other.versionFacts)) {
      if (!target.versionFacts[key] || newer(value, target.versionFacts[key]))
        target.versionFacts[key] = value
    }
    target.observations = [...target.observations, ...other.observations]
      .sort(order)
      .slice(0, 8)
    for (const [key, session] of this.aliases) {
      if (session === other)
        this.aliases.set(key, target)
    }
    this.sessions.delete(other)
  }

  add(event: ReportEvent, source: 'disk' | 'ring') {
    this.records++
    this.oldest
      = !this.oldest || event.observedAt < this.oldest
        ? event.observedAt
        : this.oldest
    this.newest
      = !this.newest || event.observedAt > this.newest
        ? event.observedAt
        : this.newest
    const { facts, diagnostic } = event
    const observation = observationOf(event, source)
    if (
      [
        'server.failure',
        'server.failure_summary',
        'client.error',
        'playback.error',
      ].includes(event.event)
    ) {
      this.errors.push(observation)
      this.errors.sort(order)
      this.errors.length = Math.min(16, this.errors.length)
    }
    const actor = actorOf(facts)
    const clientId = diagnostic?.clientSessionId ?? text(facts.clientSessionId)
    const playbackId
      = event.origin === 'server' || facts.sessionBinding === 'owned'
        ? text(facts.session)
        : undefined
    // Unknown actor records stay separate by origin; no actor-safe join is claimed.
    const scope = actor ?? `unknown:${event.origin}:${this.records}`
    const clientKey = clientId ? `${scope}:client:${clientId}` : undefined
    const playbackKey = playbackId
      ? `${scope}:playback:${facts.serverInstance ?? 'unknown'}:${playbackId}`
      : undefined
    const actionId
      = event.origin === 'server' ? text(facts.actionId) : diagnostic?.actionId
    const canLinkAction
      = event.origin === 'server'
        || !diagnostic?.session
        || facts.sessionBinding === 'owned'
    const actionKey
      = actor && actionId && canLinkAction
        ? `${scope}:action:${facts.serverInstance ?? 'unknown'}:${actionId}`
        : undefined
    const keys = [clientKey, playbackKey, actionKey].filter(
      (key): key is string => !!key,
    )
    if (!keys.length) {
      this.unboundRecords++
      return
    }
    const existing = keys
      .map(key => this.aliases.get(key))
      .filter((session): session is Session => !!session)
    let session = existing[0]
    if (!session) {
      if (this.sessions.size >= 64 || this.aliases.size >= 1024) {
        this.truncated = true
        return
      }
      session = {
        id: keys[0]!,
        actor: scope,
        firstServerObservedAt: event.observedAt,
        lastServerObservedAt: event.observedAt,
        hasClientEvents: false,
        hasServerPlayback: false,
        terminalObserved: false,
        sources: new Set(),
        instances: new Set(),
        instancesTruncated: false,
        versionFacts: {},
        observations: [],
        seqs: new Set(),
        seqTruncated: false,
        explicitLossRecords: 0,
        actionIds: new Set(),
        parents: new Set(),
        contextTruncated: !actor,
      }
      this.sessions.add(session)
    }
    for (const other of existing.slice(1)) this.merge(session, other)
    if (clientKey) {
      session.id
        = clientKey < session.id || !session.hasClientEvents
          ? clientKey
          : session.id
    }
    for (const key of keys) {
      if (this.aliases.has(key) || this.aliases.size < 1024) {
        this.aliases.set(key, session)
      }
      else {
        session.contextTruncated = true
        this.truncated = true
      }
    }
    session.firstServerObservedAt
      = session.firstServerObservedAt < event.observedAt
        ? session.firstServerObservedAt
        : event.observedAt
    session.lastServerObservedAt
      = session.lastServerObservedAt > event.observedAt
        ? session.lastServerObservedAt
        : event.observedAt
    session.hasClientEvents ||= event.origin === 'client'
    session.hasServerPlayback
      ||= event.origin === 'server'
        && (event.event.startsWith('playback.') || !!playbackId)
    session.terminalObserved
      ||= event.event === 'playback.closed' || event.event === 'player.summary'
    session.sources.add(source)
    if (typeof facts.serverInstance === 'string') {
      session.instancesTruncated
        = this.union(session.instances, new Set([facts.serverInstance]), 8)
          || session.instancesTruncated
      this.truncated ||= session.instancesTruncated
    }
    const setVersion = (
      key: string,
      value: string,
      origin: 'client' | 'server',
    ) => {
      const fact = {
        value,
        observedAt: event.observedAt,
        origin,
        source,
        ...(origin === 'client' && diagnostic
          ? { clientSessionId: diagnostic.clientSessionId }
          : {}),
        ...(text(facts.serverInstance)
          ? { serverInstance: text(facts.serverInstance) }
          : {}),
      }
      if (!session.versionFacts[key] || newer(fact, session.versionFacts[key]))
        session.versionFacts[key] = fact
    }
    if (typeof facts.serverVersion === 'string')
      setVersion('serverVersion', facts.serverVersion, 'server')
    if (
      diagnostic?.event === 'client.started'
      || diagnostic?.event === 'client.environment'
    ) {
      setVersion('tvBuildId', diagnostic.tvBuildId, 'client')
      setVersion('clientKind', diagnostic.clientKind, 'client')
      if (diagnostic.shellVersion)
        setVersion('shellVersion', diagnostic.shellVersion, 'client')
    }
    if (diagnostic) {
      session.seqTruncated
        = this.union(
          session.seqs,
          new Set([`${diagnostic.clientSessionId}:${diagnostic.clientSeq}`]),
          128,
        ) || session.seqTruncated
    }
    if (event.event === 'diagnostics.loss')
      session.explicitLossRecords++
    for (const [field, set] of [
      ['actionId', session.actionIds],
      ['parentActionId', session.parents],
    ] as const) {
      const value
        = event.origin === 'client' ? diagnostic?.[field] : facts[field]
      if (typeof value === 'string') {
        session.contextTruncated
          = this.union(set, new Set([value]), 64) || session.contextTruncated
      }
    }
    session.observations.push(observation)
    session.observations.sort(order)
    session.observations.length = Math.min(8, session.observations.length)
  }

  result() {
    return {
      recentErrors: this.errors,
      availableWindow: { oldest: this.oldest, newest: this.newest },
      records: this.records,
      unboundRecords: this.unboundRecords,
      summaryTruncated: this.truncated,
      interpretation: {
        sequenceGaps: 'gaps_in_observed_exported_sequence_not_proven_loss',
        explicitLoss: 'record_count_not_unique_lost_events',
        absentTerminal: 'termination_not_observed_not_proof_of_crash',
        historyWithoutInstance: 'unknown_not_current_instance',
        terminalObserved:
          'at_least_one_playback_terminal_not_client_session_termination',
        requestIds:
          'requestId_server_observed_ingestRequestId_receiver_post_reportedRequestId_client_claim',
      },
      sessions: [...this.sessions]
        .sort(
          (a, b) =>
            b.lastServerObservedAt.localeCompare(a.lastServerObservedAt)
            || a.id.localeCompare(b.id),
        )
        .map((session) => {
          const seqs = [...session.seqs]
            .map((key) => {
              const split = key.lastIndexOf(':')
              return {
                client: key.slice(0, split),
                seq: Number(key.slice(split + 1)),
              }
            })
            .sort((a, b) => a.client.localeCompare(b.client) || a.seq - b.seq)
          let gaps = 0
          for (let i = 1; i < seqs.length; i++) {
            if (
              seqs[i]!.client === seqs[i - 1]!.client
              && seqs[i]!.seq > seqs[i - 1]!.seq + 1
            ) {
              gaps++
            }
          }
          return {
            id: session.id,
            actor: session.actor,
            firstServerObservedAt: session.firstServerObservedAt,
            lastServerObservedAt: session.lastServerObservedAt,
            hasClientEvents: session.hasClientEvents,
            hasServerPlayback: session.hasServerPlayback,
            clientDiagnostics: session.hasClientEvents
              ? 'observed'
              : 'not_observed_reason_unknown',
            terminalObserved: session.terminalObserved,
            sources: [...session.sources].sort(),
            serverInstances: [...session.instances].sort(),
            serverInstancesTruncated: session.instancesTruncated,
            versions: Object.fromEntries(
              Object.entries(session.versionFacts).map(([key, value]) => [
                key,
                value.value,
              ]),
            ),
            versionFacts: session.versionFacts,
            lastObservations: session.observations,
            observedSequenceGaps: gaps,
            sequenceSummaryTruncated: session.seqTruncated,
            explicitLossRecords: session.explicitLossRecords,
            context: session.contextTruncated
              ? 'unknown'
              : [...session.parents].some(id => !session.actionIds.has(id))
                  ? 'context_missing'
                  : 'observed_links_only',
          }
        }),
    }
  }
}
