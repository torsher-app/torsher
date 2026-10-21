/**
 * Скачивает закреплённый релиз rqbit под текущую платформу в каталог данных
 * и проверяет его контрольную сумму. Бинарник с другой суммой не сохраняется.
 * Повторный запуск ничего не скачивает, если нужная версия уже на месте.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  installedRqbitPath,
  RQBIT_VERSION,
  rqbitAssetFor,
  rqbitDownloadUrl,
} from '../src/services/engine/release.ts'

async function sha256Of(path: string) {
  const hash = createHash('sha256')

  await pipeline(createReadStream(path), hash)

  return hash.digest('hex')
}

const asset = rqbitAssetFor(process.platform, process.arch)

if (!asset) {
  console.error(
    `Для ${process.platform}-${process.arch} нет сборки rqbit ${RQBIT_VERSION}: укажите свой бинарник в RQBIT_PATH`,
  )
  process.exit(1)
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

const response = await fetch(url)

if (!response.ok || !response.body) {
  console.error(`Не удалось скачать rqbit: HTTP ${response.status}`)
  process.exit(1)
}

await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))

const actual = await sha256Of(partial)

if (actual !== asset.sha256) {
  await rm(partial, { force: true })
  console.error(
    `Контрольная сумма не совпала: ожидалась ${asset.sha256}, получена ${actual}`,
  )
  process.exit(1)
}

await chmod(partial, 0o755)
await rename(partial, target)
console.log(`rqbit ${RQBIT_VERSION} установлен: ${target}`)
