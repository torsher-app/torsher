import type {
  ApiRequestContext,
  DiagnosticAck,
  DiagnosticEvent,
  DiagnosticStatus,
} from '@torsher/api-client'
import { sanitizeEvent } from './sanitize.ts'

type StripEnvelope<T> = T extends DiagnosticEvent
  ? Omit<
    T,
      'eventId' | 'clientSessionId' | 'clientSeq' | 'clientTime' | 'elapsedMs'
  >
  : never
export type DiagnosticInput = StripEnvelope<DiagnosticEvent>
export type DiagnosticContext = Readonly<ApiRequestContext>
interface Item {
  event: DiagnosticEvent
  expiresAt: number
  critical?: boolean
  quarantined?: boolean
}
interface Stored {
  deviceId: string | null
  profileId: string
  items: Item[]
}
interface Dependencies {
  fetch: typeof fetch
  now: () => number
  random: () => number
  storage?: Storage
  schedule: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>
  cancel: (timer: ReturnType<typeof setTimeout>) => void
  beacon?: (url: string, body: Blob) => boolean
  onSupportChange?: (enabled: boolean) => void
  keepalive?: boolean
}
export function isSupportEvent(event: string) {
  return [
    'client.environment',
    'client.error',
    'client.error_summary',
    'playback.snapshot',
  ].includes(event)
}
const prefix = 'torsher.diagnostics.v1.'
const ttl = 24 * 60 * 60 * 1000
const bytes = (value: unknown) => JSON.stringify(value).length // sanitized strings are ASCII

/** No IO at import. One collector belongs to one running showcase. */
export function createDiagnostics(deps: Dependencies) {
  let sessionId = makeId()
  let sequence = 0
  let started = deps.now()
  let support = false
  let binding: DiagnosticStatus | undefined
  let profileIdentity: string | undefined
  let queue: Item[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let unavailable = false
  function notifySupport() {
    const next
      = active
        && !unavailable
        && binding?.collecting === true
        && binding.supportFacts === 1
    if (next === support)
      return
    support = next
    try {
      deps.onSupportChange?.(next)
    }
    catch {
      /* diagnostics must not affect playback */
    }
  }
  let inFlight = false
  let epoch = 0
  let failures = 0
  let batchSize = 16
  const losses: Partial<
    Record<
      | 'overflow'
      | 'expiry'
      | 'auth'
      | 'storage'
      | 'rate_limit'
      | 'invalid_event',
      number
    >
  > = {}
  function loss(reason: keyof typeof losses, count = 1) {
    losses[reason] = Math.min(1_000_000, (losses[reason] ?? 0) + count)
  }
  let reportingLoss = false
  let lossReportedAt = -Infinity
  let hiddenBody: string | undefined
  let startedReported = false
  let nextAt = 0
  let persistedAt = -Infinity
  let negotiating: Promise<void> | undefined
  let client: Extract<DiagnosticInput, { event: 'client.started' }> | undefined
  function makeId() {
    return `tv-${deps.now().toString(36)}-${Math.floor(deps.random() * 0x100000000).toString(36)}-${Math.floor(deps.random() * 0x100000000).toString(36)}`
  }
  function expire() {
    const before = queue.filter(
      item => item.event.event !== 'diagnostics.loss',
    ).length
    queue = queue.filter(
      item =>
        item.expiresAt > deps.now() && item.expiresAt <= deps.now() + ttl,
    )
    loss(
      'expiry',
      before
      - queue.filter(item => item.event.event !== 'diagnostics.loss').length,
    )
  }
  function readStored(key: string): Stored | undefined {
    try {
      const text = deps.storage?.getItem(key) ?? 'null'
      if (text.length > 65536) {
        loss('storage')
        return
      }
      const raw: unknown = JSON.parse(text)
      if (!raw || typeof raw !== 'object')
        return
      const value = raw as Stored
      if (
        typeof value.profileId !== 'string'
        || (value.deviceId !== null && typeof value.deviceId !== 'string')
        || !Array.isArray(value.items)
      ) {
        return
      }
      const items: Item[] = []
      for (const item of value.items.slice(0, 64)) {
        const event = sanitizeEvent(item?.event)
        if (
          event
          && Number.isFinite(item.expiresAt)
          && item.expiresAt > deps.now()
          && item.expiresAt <= deps.now() + ttl
          && item.expiresAt <= Date.parse(event.clientTime) + ttl
        ) {
          items.push({
            event,
            expiresAt: item.expiresAt,
            ...(item.critical === true ? { critical: true } : {}),
            ...(item.quarantined === true ? { quarantined: true } : {}),
          })
        }
        else {
          loss(event ? 'expiry' : 'storage')
        }
      }
      return { deviceId: value.deviceId, profileId: value.profileId, items }
    }
    catch {
      loss('storage')
      return undefined
    }
  }
  function keys() {
    const result: string[] = []
    const storage = deps.storage
    if (storage) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(prefix))
          result.push(key)
      }
    }
    return result
  }
  function persist(force = false) {
    expire()
    if (!force && deps.now() - persistedAt < 2000)
      return
    persistedAt = deps.now()
    if (!binding || !deps.storage)
      return
    try {
      // The origin budget covers every tab/session, not 64 events per tab.
      let count = 0
      let size = 0
      for (const key of keys()) {
        if (key === prefix + sessionId)
          continue
        const old = readStored(key)
        if (!old || !old.items.length) {
          deps.storage.removeItem(key)
        }
        else {
          if (count + old.items.length > 64 || size + bytes(old) > 63000) {
            deps.storage.removeItem(key)
            loss('overflow', old.items.length)
          }
          else {
            deps.storage.setItem(key, JSON.stringify(old))
            count += old.items.length
            size += bytes(old)
          }
        }
      }
      const items: Item[] = []
      for (const item of queue.slice().reverse()) {
        if (
          items.length + count >= 64
          || size + bytes(items) + bytes(item) > 63000
        ) {
          break
        }
        items.unshift(item)
      }
      if (items.length) {
        deps.storage.setItem(
          prefix + sessionId,
          JSON.stringify({
            deviceId: binding.deviceId,
            profileId: binding.profileId,
            items,
          }),
        )
      }
      else {
        deps.storage.removeItem(prefix + sessionId)
      }
    }
    catch {
      loss('storage')
    }
  }
  function schedule(delay = 2000) {
    if (timer !== undefined || !active || unavailable)
      return
    timer = deps.schedule(
      () => {
        timer = undefined
        persist()
        void flush()
      },
      Math.max(delay, nextAt - deps.now()),
    )
  }
  function add(
    input: DiagnosticInput,
    context?: DiagnosticContext,
    critical = false,
  ) {
    if (
      !active
      || (isSupportEvent(input.event) && !support)
      || !binding?.collecting
      || (context?.clientSessionId && context.clientSessionId !== sessionId)
    ) {
      return
    }
    expire()
    const event = sanitizeEvent({
      ...context,
      ...input,
      eventId: `${sessionId}:${++sequence}`,
      clientSessionId: sessionId,
      clientSeq: sequence,
      clientTime: new Date(deps.now()).toISOString(),
      elapsedMs: Math.max(0, deps.now() - started),
    })
    if (!event)
      return
    queue.push({
      event,
      expiresAt: deps.now() + ttl,
      ...(critical ? { critical: true } : {}),
    })
    while (queue.length > 128 || bytes(queue) > 128 * 1024) {
      const index = queue.findIndex(item => !item.critical)
      queue.splice(index < 0 ? 0 : index, 1)
      loss('overflow')
    }
    if (critical)
      persist(true)
    if (critical || queue.length >= batchSize)
      void flush()
    else schedule()
  }
  async function send(url: string, init: RequestInit) {
    const controller = new AbortController()
    const timeout = deps.schedule(() => controller.abort(), 15000)
    try {
      return await deps.fetch(url, { ...init, signal: controller.signal })
    }
    finally {
      deps.cancel(timeout)
    }
  }
  async function negotiate() {
    if (unavailable || !active)
      return
    if (negotiating)
      return negotiating
    const run = epoch
    negotiating = (async () => {
      try {
        const response = await send('/api/diagnostics', {
          credentials: 'same-origin',
        })
        if (run !== epoch)
          return
        if (response.status === 404) {
          unavailable = true
          active = false
          notifySupport()
          return
        }
        if (response.status === 401 || response.status === 403) {
          active = false
          notifySupport()
          return
        }
        if (!response.ok) {
          schedule(5000)
          return
        }
        const value = (await response.json()) as DiagnosticStatus
        if (run !== epoch)
          return
        if (
          value.schemaVersion !== 1
          || typeof value.profileId !== 'string'
          || !/^[\w-]{8,80}$/.test(value.profileId)
          || (value.deviceId !== null
            && (typeof value.deviceId !== 'string'
              || !/^[\w-]{8,80}$/.test(value.deviceId)))
            || typeof value.enabled !== 'boolean'
            || typeof value.collecting !== 'boolean'
        ) {
          unavailable = true
          notifySupport()
          return
        }
        binding = value
        notifySupport()
        if (!value.enabled || !value.collecting) {
          queue = []
          try {
            for (const key of keys()) deps.storage?.removeItem(key)
          }
          catch {
            /* unavailable storage */
          }
          schedule(30000)
          return
        }
        try {
          for (const key of keys()) {
            const stored = readStored(key)
            if (
              stored?.profileId === value.profileId
              && stored.deviceId === value.deviceId
            ) {
              const seen = new Set(queue.map(item => item.event.eventId))
              queue.push(
                ...stored.items.filter(item => !seen.has(item.event.eventId)),
              )
            }
            else if (stored) {
              loss('auth', stored.items.length)
            }
            deps.storage?.removeItem(key)
          }
        }
        catch {
          loss('storage')
        }
        const unsupported = queue.filter(
          item => isSupportEvent(item.event.event) && !support,
        )
        loss('invalid_event', unsupported.length)
        queue = queue.filter(item => !unsupported.includes(item))
        while (queue.length > 128 || bytes(queue) > 128 * 1024) {
          queue.shift()
          loss('overflow')
        }
        if (client && !startedReported) {
          startedReported = true
          add(client)
        }
        schedule()
      }
      catch {
        schedule(5000)
      }
      finally {
        if (run === epoch)
          negotiating = undefined
      }
    })()
    return negotiating
  }
  async function flush(hidden = false) {
    if (!active || unavailable || inFlight || reportingLoss)
      return
    if (!binding?.collecting) {
      await negotiate()
      return
    }
    expire()
    if (
      !reportingLoss
      && deps.now() - lossReportedAt >= 60_000
      && Object.values(losses).some(count => count > 0)
    ) {
      lossReportedAt = deps.now()
      reportingLoss = true
      for (const reason of Object.keys(losses) as (keyof typeof losses)[]) {
        const count = losses[reason] ?? 0
        delete losses[reason]
        if (count)
          add({ event: 'diagnostics.loss', reason, count })
      }
      reportingLoss = false
    }
    if (!queue.length)
      return
    if (!hidden && deps.now() < nextAt) {
      schedule()
      return
    }
    const items = queue.filter(item => !item.quarantined).slice(0, batchSize)
    if (!items.length)
      return
    while (items.length > 1 && bytes(items) > 30000) items.pop()
    const body = JSON.stringify({
      schemaVersion: 1,
      deviceId: binding.deviceId,
      profileId: binding.profileId,
      events: items.map(item => item.event),
    })
    persist(hidden)
    if (hidden && hiddenBody !== undefined)
      return
    if (hidden)
      hiddenBody = body
    if (hidden && !deps.keepalive) {
      try {
        deps.beacon?.(
          '/api/diagnostics/events',
          new Blob([body], { type: 'application/json' }),
        )
      }
      catch {
        /* best effort */
      }
      return // Beacon queueing is not an ACK.
    }
    inFlight = true
    const run = epoch
    try {
      const response = await send('/api/diagnostics/events', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body,
        ...(hidden ? { keepalive: true } : {}),
      })
      if (run !== epoch)
        return
      if (response.status === 401 || response.status === 403) {
        active = false
        notifySupport()
        queue = []
        persist(true)
        return
      }
      if (response.status === 409) {
        reset()
        await negotiate()
        return
      }
      if (response.status === 413) {
        if (items.length === 1) {
          queue = queue.filter(item => item !== items[0])
          loss('storage')
        }
        else {
          batchSize = Math.max(1, Math.floor(items.length / 2))
        }
        return
      }
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After')
        nextAt
          = deps.now()
            + (retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Math.max(2000, Date.parse(retry ?? '') - deps.now()) || 30000)
        return
      }
      if (!response.ok && response.status !== 400)
        throw new Error('transport')
      const ack = (await response.json()) as DiagnosticAck
      if (run !== epoch)
        return
      if (response.status === 400 && !Array.isArray(ack.rejected)) {
        // Older/mismatched validators may reject the envelope without naming IDs.
        // Isolate it before quarantining; valid neighbours still get their ACK.
        if (items.length > 1)
          batchSize = Math.max(1, Math.floor(items.length / 2))
        else items[0]!.quarantined = true
        nextAt = deps.now() + 2000
        persist()
        return
      }
      const sent = new Set(items.map(item => item.event.eventId))
      const removed = new Set(
        [
          ...(Array.isArray(ack.accepted) ? ack.accepted : []),
          ...(Array.isArray(ack.duplicate) ? ack.duplicate : []),
          ...(Array.isArray(ack.rejected)
            ? ack.rejected
                .filter(item => item.code === 'invalid_event')
                .map(item => item.eventId)
            : []),
        ].filter(id => sent.has(id)),
      )
      const rejected = Array.isArray(ack.rejected)
        ? ack.rejected.filter(item => sent.has(item.eventId))
        : []
      const invalid = new Set(
        rejected
          .filter(item => item.code === 'invalid_event')
          .map(item => item.eventId),
      )
      // A loss report rejected by the same validator must not generate another loss report.
      loss(
        'invalid_event',
        items.filter(
          item =>
            invalid.has(item.event.eventId)
            && item.event.event !== 'diagnostics.loss',
        ).length,
      )
      queue = queue.filter(item => !removed.has(item.event.eventId))
      if (
        ack.rejected?.some(
          item => item.code === 'disabled' || item.code === 'level_filtered',
        )
      ) {
        queue = []
        persist(true)
        binding = undefined
        notifySupport()
      }
      if (rejected.some(item => item.code === 'journal_unavailable')) {
        nextAt
          = deps.now()
            + [2000, 5000, 15000, 30000][Math.min(failures++, 3)]!
            + deps.random() * 500
      }
      else {
        failures = 0
        nextAt = 0
      }
      batchSize = 16
      persist()
    }
    catch {
      nextAt
        = deps.now()
          + [2000, 5000, 15000, 30000][Math.min(failures++, 3)]!
          + deps.random() * 500
      if (hidden) {
        try {
          deps.beacon?.(
            '/api/diagnostics/events',
            new Blob([body], { type: 'application/json' }),
          )
        }
        catch {
          /* best effort */
        }
      }
    }
    finally {
      inFlight = false
      if (run === epoch)
        schedule()
    }
  }
  function reset() {
    epoch++
    negotiating = undefined
    startedReported = false
    hiddenBody = undefined
    loss('auth', queue.length)
    queue = []
    try {
      deps.storage?.removeItem(prefix + sessionId)
    }
    catch {
      /* unavailable storage */
    }
    binding = undefined
    notifySupport()
    sessionId = makeId()
    sequence = 0
    started = deps.now()
    nextAt = 0
    persistedAt = -Infinity
  }
  return {
    add,
    flush,
    negotiate,
    foreground() {
      hiddenBody = undefined
      void flush()
    },
    action(parent?: DiagnosticContext): DiagnosticContext {
      return Object.freeze({
        actionId: makeId(),
        ...(parent?.actionId && parent.clientSessionId === sessionId
          ? { parentActionId: parent.actionId }
          : {}),
        clientSessionId: sessionId,
      })
    },
    request(context: DiagnosticContext): DiagnosticContext | undefined {
      if (
        !active
        || !binding?.collecting
        || context.clientSessionId !== sessionId
      ) {
        return undefined
      }
      return Object.freeze({ ...context, clientRequestId: makeId() })
    },
    start(value: Extract<DiagnosticInput, { event: 'client.started' }>) {
      if (active || unavailable)
        return
      client = value
      active = true
      try {
        for (const key of keys()) {
          const stored = readStored(key)
          if (stored?.items.length)
            deps.storage?.setItem(key, JSON.stringify(stored))
          else deps.storage?.removeItem(key)
        }
      }
      catch {
        loss('storage')
      }
      void negotiate()
    },
    beforeProfileChange(nextProfileId?: string) {
      if (!profileIdentity && (!binding || binding.profileId === nextProfileId))
        return
      void flush(true)
      reset()
      profileIdentity = undefined
    },
    profileChanged(profileId?: string) {
      if (
        !profileId
        || (profileIdentity && profileIdentity !== profileId)
        || (binding && binding.profileId !== profileId)
      ) {
        reset()
      }
      else {
        // Initial profile resolution establishes the actor, not a new intention.
        epoch++
        negotiating = undefined
      }
      profileIdentity = profileId
      active = !unavailable
      void negotiate()
    },
    stop() {
      profileIdentity = undefined
      active = false
      reset()
      if (timer !== undefined)
        deps.cancel(timer)
      timer = undefined
    },
    inspect() {
      expire()
      return { queued: queue.length, active, sessionId, binding }
    },
  }
}
