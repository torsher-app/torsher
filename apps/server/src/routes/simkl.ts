import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import { profileIdParams } from '../dto/profiles.ts'
import {
  simklDeviceInput,
  simklDirectionsInput,
  simklError,
  simklStatus,
  simklSyncInput,
} from '../dto/simkl.ts'
import { requireOwner, requireSameOriginRead } from '../middleware/auth.ts'
import { getProfile } from '../services/profiles/index.ts'
import {
  cancelSimklDevice,
  changeSimklDirections,
  connectSimklDevice,
  disconnectSimkl,
  pollSimklDevice,
  retrySimkl,
  simklProfileStatus,
  startSimklPull,
} from '../services/simkl/index.ts'
import { SimklError } from '../services/simkl/client.ts'

function schema(operationId: string) {
  return {
    operationId,
    tags: ['Profiles'],
    params: profileIdParams,
    response: {
      200: simklStatus,
      401: messageResponse,
      404: simklError,
      409: simklError,
      422: simklError,
    },
  }
}

async function action(reply: FastifyReply, id: string, run?: () => unknown) {
  if (!getProfile(id))
    return reply.code(404).send({ kind: 'profile' })
  try {
    await run?.()
    return simklProfileStatus(id)
  }
  catch (error) {
    const kind = error instanceof SimklError ? error.kind : 'provider'
    return reply.code(kind === 'busy' || kind === 'identity' ? 409 : 422).send({ kind })
  }
}

export const simklRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireOwner)
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  app.get('', { onRequest: requireSameOriginRead, schema: schema('getProfileSimkl') }, ({ params }, reply) => action(reply, params.id))

  app.post('/device', { schema: { ...schema('postProfileSimklDevice'), body: simklDeviceInput } }, ({ params, body }, reply) => action(reply, params.id, () => connectSimklDevice(params.id, body.scope)))

  app.post('/device/poll', { schema: schema('postProfileSimklDevicePoll') }, ({ params }, reply) => action(reply, params.id, () => pollSimklDevice(params.id)))

  app.delete('/device', { schema: schema('deleteProfileSimklDevice') }, ({ params }, reply) => action(reply, params.id, () => cancelSimklDevice(params.id)))

  app.patch('', { schema: { ...schema('patchProfileSimkl'), body: simklDirectionsInput } }, ({ params, body }, reply) => action(reply, params.id, () => changeSimklDirections(params.id, body)))

  app.post('/sync', { schema: { ...schema('postProfileSimklSync'), body: simklSyncInput } }, ({ params, body }, reply) => action(reply, params.id, () => startSimklPull(params.id, body.mode)))

  app.post('/retry', { schema: schema('postProfileSimklRetry') }, ({ params }, reply) => action(reply, params.id, () => retrySimkl(params.id)))

  app.delete('', { schema: schema('deleteProfileSimkl') }, ({ params }, reply) => action(reply, params.id, () => disconnectSimkl(params.id)))
}
