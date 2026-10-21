/**
 * Скачивает закреплённый релиз rqbit под текущую платформу в каталог данных
 * и проверяет его контрольную сумму. Бинарник с другой суммой не сохраняется.
 * Повторный запуск ничего не скачивает, если нужная версия уже на месте.
 *
 * `--optional` — запуск перед `pnpm dev`: без сети или сборки под платформу
 * скрипт только предупреждает, и сервер стартует без движка.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from '../src/config.ts'
import {
  installedRqbitPath,
  RQBIT_VERSION,
  rqbitAssetFor,
  rqbitDownloadUrl,
} from '../src/services/engine/release.ts'

const optional = process.argv.includes('--optional')

function fail(message: string): never {
  if (optional) {
    console.warn(`${message}. Сервер запустится без движка`)
    process.exit(0)
  }

  console.error(message)
  process.exit(1)
}

async function sha256Of(path: string) {
  const hash = createHash('sha256')

  await pipeline(createReadStream(path), hash)

  return hash.digest('hex')
}

// Свой бинарник: ставить нечего
if (config.rqbitPath) {
  console.log(`Движок задан в RQBIT_PATH: ${config.rqbitPath}`)
  process.exit(0)
}

const asset = rqbitAssetFor(process.platform, process.arch)

if (!asset) {
  fail(
    `Для ${process.platform}-${process.arch} нет сборки rqbit ${RQBIT_VERSION}: укажите свой бинарник в RQBIT_PATH`,
  )
}

const target = installedRqbitPath()

if (existsSync(target) && (await sha256Of(target)) === asset.sha256) {
  console.log(`rqbit ${RQBIT_VERSION} уже установлен: ${target}`)
  process.exit(0)
}

const url = rqbitDownloadUrl(asset)
const partial = `${target}.download`

await mkdir(dirname(target), { recursive: true })
console.log(`Скачиваю ${url}`)

try {
  const response = await fetch(url)

  if (!response.ok || !response.body)
    fail(`Не удалось скачать rqbit: HTTP ${response.status}`)

  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
}
catch (err) {
  await rm(partial, { force: true })
  fail(`Не удалось скачать rqbit: ${err instanceof Error ? err.message : err}`)
}

const actual = await sha256Of(partial)

if (actual !== asset.sha256) {
  await rm(partial, { force: true })
  fail(
    `Контрольная сумма не совпала: ожидалась ${asset.sha256}, получена ${actual}`,
  )
}

await chmod(partial, 0o755)
await rename(partial, target)
console.log(`rqbit ${RQBIT_VERSION} установлен: ${target}`)
