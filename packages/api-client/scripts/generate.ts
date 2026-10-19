/**
 * Генерирует типизированный API-клиент из OpenAPI-спеки сервера.
 *
 * Спека читается из файла (apps/server/openapi.json), а не по HTTP:
 * генерация не требует ни запущенного сервера, ни базы.
 * Скрипт `generate` пакета сначала перевыгружает спеку, затем вызывает этот файл.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { generateApi } from 'swagger-typescript-api'

const ROOT = join(import.meta.dirname, '..')
const SPEC = join(ROOT, '../../apps/server/openapi.json')

if (!existsSync(SPEC)) {
  console.error(`Спека не найдена: ${SPEC}`)
  console.error('Сначала выполни: pnpm --filter @torsher/server openapi')
  process.exit(1)
}

await generateApi({
  input: SPEC,
  output: join(ROOT, 'src', 'generated'),
  fileName: 'index.ts',
  httpClientType: 'fetch',
  unwrapResponseData: true,
  extractResponseError: true,
  silent: true,
})

console.log(
  'API-клиент сгенерирован: packages/api-client/src/generated/index.ts',
)
