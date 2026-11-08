import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { migrateDb } from '../../db/index.ts'
import {
  closeLogFiles,
  createLogger,
  installLogger,
  logFor,
  queryLogs,
} from '../logs/index.ts'
import { projectRecord, projectRingEntry } from '../logs/reportProjection.ts'
import { LOG_RETENTION_MS } from '../logs/ring.ts'
import { setSetting } from '../settings/index.ts'
import { parseEngineLine } from './supervisor.ts'

const hash = '0123456789abcdef0123456789abcdef01234567'
const marker = 'PRIVATE_MARKER'
const dirs: string[] = []
beforeAll(() => migrateDb())
afterEach(async () => {
  await closeLogFiles()
  installLogger(pino({ level: 'silent' }))
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('engine diagnostic boundary', () => {
  it('records typed subsystem facts with viewer diagnostics disabled, searches their hash and safely exports', async () => {
    setSetting('userActionDiagnostics', false)
    const dir = mkdtempSync(join(tmpdir(), 'torsher-engine-logs-'))
    dirs.push(dir)
    const stdout: string[] = []
    installLogger(
      createLogger({
        level: 'info',
        logsDir: dir,
        stdout: { write: line => stdout.push(line) },
      }),
    )
    const entry = parseEngineLine(
      `level=ERROR msg="engine API failed" event=engine.api_error origin=client operation="GET /torrents/{hash}/stats" statusCode=503 errorKind=other infoHash=${hash} token=${marker} err=${marker} details=${marker}`,
    )!
    logFor('engine')[entry.level](entry.fields, entry.message)
    const records = queryLogs({ q: hash }).entries
    expect(records).toHaveLength(1)
    expect(records[0]!.context).toEqual({
      event: 'engine.api_error',
      origin: 'server',
      operation: 'GET /torrents/{hash}/stats',
      statusCode: 503,
      errorKind: 'other',
      infoHash: hash,
    })
    const projection = projectRingEntry(
      records[0]!,
      Date.now(),
      LOG_RETENTION_MS,
    )
    expect(projection).toMatchObject({
      kind: 'event',
      value: {
        event: 'engine.api_error',
        origin: 'server',
        facts: { infoHash: hash, statusCode: 503 },
      },
    })
    expect(JSON.stringify(projection)).not.toContain(marker)
    expect(stdout.join('')).not.toContain(marker)
    await closeLogFiles()
    const disk = readFileSync(join(dir, 'torsher.log'), 'utf8')
    expect(disk).not.toContain(marker)
    const record = JSON.parse(disk.trim())
    expect(typeof record.statusCode).toBe('number')
    expect(record.origin).toBe('server')
    expect(projectRecord(record, Date.now(), LOG_RETENTION_MS)).toEqual(
      projection,
    )

    expect(queryLogs({ q: 'another-hash' }).entries).toEqual([])
  })
  it.each([
    [
      'engine.network',
      'engine network configured',
      'INFO',
      'peerPort=2345 dht=true pex=false upnp=true encryption=require connsPerTorrent=50 connsTotal=0',
      {
        peerPort: 2345,
        dht: true,
        pex: false,
        upnp: true,
        encryption: 'require',
        connsPerTorrent: 50,
        connsTotal: 0,
      },
    ],
    [
      'engine.stream_wait',
      'stream read stalled',
      'WARN',
      `infoHash=${hash} fileIndex=2 piece=32 elapsedMs=10001 statsKnown=true statsAgeMs=300 peers=5 found=20 seeders=3 halfOpen=1 downRate=8192`,
      {
        seeders: 3,
        halfOpen: 1,
        downRate: 8192,
        statsKnown: true,
        statsAgeMs: 300,
      },
    ],
    [
      'engine.stream_wait',
      'stream read stalled',
      'WARN',
      `infoHash=${hash} fileIndex=2 piece=32 elapsedMs=10001 statsKnown=false`,
      { statsKnown: false },
    ],
    [
      'engine.stream_resumed',
      'stream read resumed',
      'INFO',
      `infoHash=${hash} fileIndex=2 piece=32 elapsedMs=30000`,
      { elapsedMs: 30000 },
    ],
    [
      'engine.metadata_timeout',
      'metadata resolution timed out',
      'WARN',
      `infoHash=${hash} elapsedMs=30000 statsKnown=true statsAgeMs=100 downRate=0 peers=0 found=4 seeders=0 halfOpen=2`,
      { peers: 0, found: 4, seeders: 0, halfOpen: 2 },
    ],
    [
      'engine.metadata_timeout',
      'metadata resolution timed out',
      'WARN',
      `infoHash=${hash} elapsedMs=30000 statsKnown=false`,
      { statsKnown: false },
    ],
    [
      'engine.storage_write_failed',
      'storage write failed',
      'ERROR',
      `infoHash=${hash} piece=12 errorKind=EACCES shortWrite=true`,
      { piece: 12, errorKind: 'EACCES', shortWrite: true },
    ],
  ])(
    'normalizes only the declared fields for %s',
    (event, message, level, fields, expected) => {
      const parsed = parseEngineLine(
        `level=${level} msg="${message}" event=${event} ${fields} url=${marker} name=${marker} stack=${marker}`,
      )!
      expect(parsed.fields).toMatchObject({
        ...expected,
        event,
        origin: 'server',
      })
      expect(parsed.details).toBeUndefined()
      const projected = projectRecord(
        {
          time: Date.now() - 1,
          source: 'engine',
          ...parsed.fields,
          msg: marker,
          details: marker,
        },
        Date.now(),
        LOG_RETENTION_MS,
      )
      expect(projected.kind).toBe('event')
      expect(JSON.stringify(projected)).not.toContain(marker)
    },
  )
  it.each([
    'statusCode=NaN errorKind=storage',
    'statusCode=503 errorKind=SECRET_MARKER',
    'statusCode=503 errorKind=storage infoHash=UPPERCASE',
    'statusCode=200 errorKind=storage',
    'statusCode=503 errorKind=storage operation="GET /private/path"',
  ])('rejects invalid typed facts: %s', (fields) => {
    const parsed = parseEngineLine(
      `level=ERROR msg="engine API failed" event=engine.api_error operation="GET /health" ${fields}`,
    )!
    expect(parsed.fields).toEqual({})
    expect(parsed.message).toBe('Invalid engine diagnostic')
  })
  it('does not trust an upstream origin or event and validates report provenance', () => {
    const parsed = parseEngineLine(
      'level=WARN msg="library warning" origin=server event=server.failure failureCode=engine_exited',
    )!
    expect(parsed.fields).not.toHaveProperty('event')
    expect(parsed.fields).not.toHaveProperty('origin')
    const raw = {
      time: Date.now() - 1,
      origin: 'server',
      source: 'playback',
      event: 'engine.api_error',
      operation: 'GET /health',
      statusCode: 503,
      errorKind: 'other',
    }
    expect(projectRecord(raw, Date.now(), LOG_RETENTION_MS).kind).toBe(
      'unstructured',
    )
    expect(
      projectRecord(
        { ...raw, source: 'engine', origin: 'client' },
        Date.now(),
        LOG_RETENTION_MS,
      ).kind,
    ).toBe('unstructured')
    expect(
      projectRecord(
        { ...raw, source: 'engine', statusCode: '503' },
        Date.now(),
        LOG_RETENTION_MS,
      ).kind,
    ).toBe('unstructured')
  })
})
