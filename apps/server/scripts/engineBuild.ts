/**
 * Собирает торрент-движок из `torsher-app/engine` в каталог данных сервера.
 * Повторная сборка без изменений исходников берётся из кэша Go и занимает
 * секунду. Убирает бинарник и сессию прежнего движка, если они остались.
 *
 * `--optional` — запуск перед `pnpm dev`: без Go скрипт только предупреждает,
 * и сервер стартует без движка.
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { config } from '../src/config.ts'
import {
  builtEnginePath,
  ENGINE_SOURCE_DIR,
} from '../src/services/engine/binary.ts'

const optional = process.argv.includes('--optional')

function fail(message: string): never {
  if (optional) {
    console.warn(`${message}. Сервер запустится без движка`)
    process.exit(0)
  }

  console.error(message)
  process.exit(1)
}

// Свой бинарник: собирать нечего
if (config.enginePath) {
  console.log(`Движок задан в ENGINE_PATH: ${config.enginePath}`)
  process.exit(0)
}

if (spawnSync('go', ['version'], { stdio: 'ignore' }).status !== 0) {
  fail(
    'Go не найден: поставьте Go 1.24+ (https://go.dev/dl/) или укажите готовый бинарник в ENGINE_PATH',
  )
}

// Go собирает из каталога исходников: относительный путь данных ушёл бы туда
const target = resolve(builtEnginePath())
const engineDir = dirname(target)

await mkdir(engineDir, { recursive: true })

// Прежний движок: бинарники `rqbit-*` и его сессия больше не нужны
for (const name of await readdir(engineDir)) {
  if (name.startsWith('rqbit-') || name === 'session')
    await rm(join(engineDir, name), { recursive: true, force: true })
}

const build = spawnSync('go', ['build', '-trimpath', '-o', target, '.'], {
  cwd: ENGINE_SOURCE_DIR,
  stdio: 'inherit',
  env: { ...process.env, CGO_ENABLED: '0' },
})

if (build.status !== 0)
  fail('Не удалось собрать движок')

console.log(`Движок собран: ${target}`)
