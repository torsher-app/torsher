import type { api } from '~/services/api'
import { del, DemoError, get, NO_CONTENT, post } from '@torsher/demo/router'
import { nextId } from '@torsher/demo/state'
import { titleNamed } from '@torsher/demo/titles'
import { requireSession } from './auth'
import { addArrDemoFollow, demoFollowTitleIds } from './follow'
import { listProfiles } from './people'

type Transfer = typeof api.transfer
type Connection = Awaited<ReturnType<Transfer['postArrConnection']>>
type ConnectionInput = Parameters<Transfer['postArrConnection']>[0]
type Start = Awaited<ReturnType<Transfer['postArrPreview']>>
type StartInput = Parameters<Transfer['postArrPreview']>[0]
type Preview = Awaited<ReturnType<Transfer['getArrPreview']>>
type Apply = Awaited<ReturnType<Transfer['postArrApply']>>
type ApplyInput = Parameters<Transfer['postArrApply']>[0]

const path = '/api/transfer/arr'
let connection:
  { id: string, kind: ConnectionInput['kind'], lan: boolean } | undefined
let job:
  | {
    id: string
    profileId: string
    titleId: string
    preview: Preview
    applied?: Apply
  }
  | undefined

function expire(): never {
  throw new DemoError(404, { kind: 'expired' })
}

post<Connection, ConnectionInput>(`${path}/connection`, ({ body }) => {
  requireSession()
  const url = new URL(body.url)
  const id = nextId('arr-connection')
  const lan = url.protocol === 'http:'
  connection = { id, kind: body.kind, lan }

  return { id, origin: url.origin, addresses: lan ? ['192.168.0.80'] : [] }
})

post<Start, StartInput>(`${path}/preview`, ({ body }) => {
  requireSession()

  if (
    connection?.id !== body.connectionId
    || (connection.lan && !body.approveLan)
  ) {
    expire()
  }

  const profile = listProfiles().find(
    profile => profile.id === body.profileId && profile.ageLimit === null,
  )
  if (!profile)
    throw new DemoError(422, { kind: 'profile' })

  const title = titleNamed(
    connection.kind === 'sonarr' ? 'Glasswing' : 'Lanterns of Vell',
  )
  const exists = demoFollowTitleIds().includes(title.id)
  const id = nextId('arr-preview')
  const preview: Preview = {
    state: 'ready',
    checked: 1,
    total: 1,
    rows: [
      {
        id: nextId('arr-row'),
        sourceTitle: title.title,
        title: title.title,
        year: title.year,
        selectable: !exists,
        selected: !exists,
        reasons: exists ? ['existing'] : [],
      },
    ],
  }
  job = { id, profileId: profile.id, titleId: title.id, preview }
  connection = undefined

  return { id }
})

get<Preview>(`${path}/preview/:id`, ({ params }) => {
  const active = job
  if (!active || active.id !== params.id)
    expire()

  return active.preview
})

del(`${path}/preview/:id`, ({ params }) => {
  if (job?.id === params.id)
    job = undefined

  return NO_CONTENT
})

post<Apply, ApplyInput>(`${path}/apply`, ({ body }) => {
  requireSession()
  const active = job
  if (!active || active.id !== body.previewId)
    expire()

  const row = active.preview.rows[0]
  if (!row?.selectable || body.rowIds.length !== 1 || body.rowIds[0] !== row.id)
    throw new DemoError(409, { kind: 'request' })

  const profile = listProfiles().find(
    profile => profile.id === active.profileId && profile.ageLimit === null,
  )
  if (!profile)
    throw new DemoError(422, { kind: 'profile' })

  if (!active.applied) {
    const created = addArrDemoFollow(active.titleId, profile)
    active.applied = created
      ? {
          created: 1,
          skipped: 0,
          failed: 0,
          rows: [{ id: row.id, outcome: 'created', reason: 'created' }],
        }
      : {
          created: 0,
          skipped: 1,
          failed: 0,
          rows: [{ id: row.id, outcome: 'skipped', reason: 'existing' }],
        }
  }

  return active.applied
})
