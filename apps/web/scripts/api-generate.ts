/**
 * Генерирует типизированный API-клиент из OpenAPI-спеки backend.
 *
 * Спека читается из файла (apps/server/openapi.json), а не по HTTP:
 * генерация не требует ни запущенного сервера, ни базы.
 * Файл openapi.json обновляется командой `pnpm --filter @torsher/server openapi`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { generateApi } from 'swagger-typescript-api'

const ROOT = join(import.meta.dirname, '..')
const SPEC = join(ROOT, '../server/openapi.json')

if (!existsSync(SPEC)) {
  console.error(`Спека не найдена: ${SPEC}`)
  console.error('Сначала выполни: pnpm --filter @torsher/server openapi')
  process.exit(1)
}

await generateApi({
  input: SPEC,
  output: join(ROOT, 'app', 'services', 'api', 'generated'),
  fileName: 'index.ts',
  httpClientType: 'fetch',
  unwrapResponseData: true,
  extractResponseError: true,
  silent: true,
})

console.log('API-клиент сгенерирован: app/services/api/generated/index.ts')
