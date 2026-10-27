/**
 * Стенд ветки: сервер, панель и витрина текущего checkout на свободных портах
 * и на копии dev-данных из основного checkout. Данные и сессии разработчика
 * не меняются: копия обезврежена, вход в неё — тестовой учёткой из
 * `.env.stand`, у cookie стенда свой префикс.
 *
 *   pnpm dev:stand            поднять стенд (уже поднят — напечатать адреса)
 *   pnpm dev:stand --empty    пустая база: мастер первого запуска
 *   pnpm dev:stand --files    вместе с загрузками и библиотекой (клоном)
 *   pnpm dev:stand --stop     остановить стенд и удалить его каталог, заодно —
 *                             брошенные стенды удалённых worktree
 *   pnpm dev:stand --stop --all   остановить и удалить все стенды
 *
 * Процессы стенда работают в фоне, пока их не остановят. Только macOS и Linux.
 */
import type { SourceData, StandData } from './standData.ts'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, openSync, readFileSync } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs, parseEnv } from 'node:util'
import { generatePassword } from '../src/cli.ts'
import { verifyPassword } from '../src/utils/password.ts'
import { normalizeUsername } from '../src/utils/username.ts'
import {
  copyData,
  dirSize,
  readOwner,
  sanitizeDb,
  savedStoragePath,
  standDirFor,
} from './standData.ts'

const { values: flags } = parseArgs({
  options: {
    stop: { type: 'boolean', default: false },
    empty: { type: 'boolean', default: false },
    files: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
  },
})

// Порты `pnpm dev`: стенд их не занимает, даже когда dev выключен
const DEV_PORTS = new Set([3000, 3001, 5173])
const READY_TIMEOUT_MS = 180_000
const LOG_TAIL_LINES = 20
const STOP_TIMEOUT_MS = 10_000

const checkout = resolve(import.meta.dirname, '../../..')
// В worktree своих данных нет: источник — основной checkout
const mainCheckout = dirname(
  resolve(
    checkout,
    execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: checkout,
      encoding: 'utf8',
    }).trim(),
  ),
)
const standsRoot = join(tmpdir(), 'torsher-stand')
const standDir = standDirFor(standsRoot, checkout)

interface StandState {
  checkout: string
  pids: Record<string, number>
  urls: { panel: string, tv: string, api: string }
  username: string
  password: string
  empty: boolean
}

/** Ошибка запуска: недоподнятый стенд удаляется целиком */
class StandError extends Error {}

function fail(message: string): never {
  throw new StandError(message)
}

function readEnvFile(path: string) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)

    return true
  }
  catch {
    return false
  }
}

function stateFile(dir: string) {
  return join(dir, 'stand.json')
}

async function readState(dir: string): Promise<StandState | undefined> {
  try {
    return JSON.parse(await readFile(stateFile(dir), 'utf8')) as StandState
  }
  catch {
    return undefined
  }
}

/** Каждый процесс — лидер своей группы: гасим вместе с дочерними */
async function killGroups(pids: number[]) {
  const signal = (pid: number, name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name)
    }
    catch {}
  }

  for (const pid of pids) signal(pid, 'SIGTERM')

  const deadline = Date.now() + STOP_TIMEOUT_MS

  while (pids.some(isAlive) && Date.now() < deadline)
    await new Promise(r => setTimeout(r, 200))

  for (const pid of pids.filter(isAlive)) signal(pid, 'SIGKILL')
}

async function writeState(state: StandState) {
  await writeFile(stateFile(standDir), JSON.stringify(state, null, 2), {
    mode: 0o600,
  })
}

function isRunning(state: StandState) {
  const pids = Object.values(state.pids)

  return pids.length > 0 && pids.every(isAlive)
}

async function removeStand(dir = standDir) {
  const state = await readState(dir)

  if (state)
    await killGroups(Object.values(state.pids))

  await rm(dir, { recursive: true, force: true })
}

/**
 * Брошенный стенд: его checkout удалён (worktree убрали, не остановив
 * стенд) или каталог без состояния пережил любой запуск
 */
async function isAbandoned(dir: string) {
  const state = await readState(dir)

  if (state)
    return !existsSync(state.checkout)

  const info = await stat(dir).catch(() => undefined)

  return Boolean(info && Date.now() - info.mtimeMs > READY_TIMEOUT_MS)
}

async function stopStand() {
  const dirs = existsSync(standsRoot)
    ? (await readdir(standsRoot)).map(name => join(standsRoot, name))
    : []
  const removed: string[] = []

  for (const dir of dirs) {
    if (dir === standDir || flags.all || (await isAbandoned(dir))) {
      await removeStand(dir)
      removed.push(dir)
    }
  }

  if (existsSync(standsRoot) && !(await readdir(standsRoot)).length)
    await rm(standsRoot, { recursive: true, force: true })

  if (!removed.length) {
    console.log('Стенд не запущен')
    return
  }

  for (const dir of removed)
    console.log(`Стенд остановлен, каталог удалён: ${dir}`)
}

async function printLogTails() {
  for (const name of ['server', 'panel', 'tv']) {
    const text = await readFile(
      join(standDir, 'logs', `${name}.log`),
      'utf8',
    ).catch(() => '')
    const tail = text.trimEnd().split('\n').slice(-LOG_TAIL_LINES).join('\n')

    if (tail)
      console.error(`\n--- ${name}.log ---\n${tail}`)
  }
}

function printState(state: StandState) {
  console.log(`
Стенд ветки: ${checkout}

  Панель    ${state.urls.panel}
  Витрина   ${state.urls.tv}
  API       ${state.urls.api}

  Вход      ${state.username}
  Пароль    ${state.password}${state.empty ? '  (создайте владельца с ними в мастере)' : ''}

  Данные    ${join(standDir, 'data')}
  Логи      ${join(standDir, 'logs')}

Остановить: pnpm dev:stand --stop`)
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()

    server.once('error', reject)
    // `::` — и IPv4, и IPv6: `localhost` dev-серверы слушают на любом из них
    server.listen(0, '::', () => {
      const { port } = server.address() as { port: number }

      server.close(() => resolvePort(port))
    })
  })
}

async function freePorts(count: number) {
  const ports = new Set<number>()

  while (ports.size < count) {
    const port = await freePort()

    if (!DEV_PORTS.has(port))
      ports.add(port)
  }

  return [...ports]
}

/** Тестовая учётка из `.env.stand`; нет файла или пароля — создаём */
async function standCredentials() {
  const path = join(mainCheckout, '.env.stand')
  const env = readEnvFile(path)
  const username = env.STAND_USERNAME?.trim() || 'stand'
  let password = env.STAND_PASSWORD?.trim()

  if (!password) {
    password = generatePassword()
    await writeFile(
      path,
      `# Тестовый вход стенда ветки (pnpm dev:stand): только для копии базы\nSTAND_USERNAME=${username}\nSTAND_PASSWORD=${password}\n`,
      { mode: 0o600 },
    )
    console.log(`Тестовая учётка записана в ${path}`)
  }

  return { username, password }
}

function sourceData(serverEnv: Record<string, string | undefined>) {
  const serverDir = join(mainCheckout, 'apps/server')
  const databasePath = resolve(
    serverDir,
    serverEnv.DATABASE_PATH || '.data/torsher.db',
  )
  const dataDir = dirname(databasePath)

  if (!existsSync(databasePath)) {
    fail(
      `Нет dev-базы ${databasePath}: запустите pnpm dev или стенд с --empty`,
    )
  }

  const envPath = (value: string | undefined, fallback: string) =>
    value ? resolve(serverDir, value) : join(dataDir, fallback)

  return {
    dataDir,
    databasePath,
    downloadsPath:
      savedStoragePath(databasePath, 'downloads')
      ?? envPath(serverEnv.DOWNLOADS_PATH, 'downloads'),
    libraryPath:
      savedStoragePath(databasePath, 'library')
      ?? envPath(serverEnv.LIBRARY_PATH, 'library'),
  } satisfies SourceData
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function runSync(
  command: string,
  args: string[],
  options: { cwd: string, env: NodeJS.ProcessEnv, input?: string },
) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: [
      options.input === undefined ? 'inherit' : 'pipe',
      'inherit',
      'inherit',
    ],
  })

  return result.status === 0
}

function start(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const log = openSync(join(standDir, 'logs', `${name}.log`), 'a')
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', log, log],
  })

  child.unref()

  return child.pid!
}

async function waitReady(urls: string[], pids: number[]) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  const pending = new Set(urls)

  while (pending.size) {
    if (Date.now() > deadline)
      return `не дождались ответа: ${[...pending].join(', ')}`

    if (!pids.every(isAlive))
      return 'процесс стенда завершился'

    for (const url of pending) {
      const ok = await fetch(url, { signal: AbortSignal.timeout(2000) })
        .then(res => res.status < 500)
        .catch(() => false)

      if (ok)
        pending.delete(url)
    }

    await new Promise(r => setTimeout(r, 500))
  }
}

async function startStand() {
  const existing = await readState(standDir)

  if (existing && isRunning(existing)) {
    printState(existing)
    return
  }

  // Остатки упавшего или недоподнятого стенда: начинаем с чистого каталога
  await removeStand()

  const serverEnv = readEnvFile(join(mainCheckout, 'apps/server/.env'))
  const { username, password } = await standCredentials()
  const dataDir = join(standDir, 'data')
  const stand = {
    dataDir,
    databasePath: join(dataDir, 'torsher.db'),
    downloadsPath: join(dataDir, 'downloads'),
    libraryPath: join(dataDir, 'library'),
  } satisfies StandData

  await mkdir(join(standDir, 'logs'), { recursive: true })
  await mkdir(dataDir, { recursive: true })

  const [apiPort, panelPort, tvPort] = await freePorts(3)
  const urls = {
    api: `http://127.0.0.1:${apiPort}`,
    panel: `http://localhost:${panelPort}`,
    tv: `http://localhost:${tvPort}`,
  }
  const state: StandState = {
    checkout,
    pids: {},
    urls,
    username,
    password,
    empty: flags.empty,
  }

  // Состояние — до копии: `--stop` из другого checkout не примет
  // поднимающийся стенд за брошенный
  await writeState(state)

  // Окружение сервера разработчика (ключ TMDB, прокси), но свои порты,
  // каталоги и секрет сессий
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...serverEnv,
    NODE_ENV: 'development',
    API_PORT: String(apiPort),
    API_HOST: '127.0.0.1',
    CLIENT_URL: urls.panel,
    DATABASE_PATH: stand.databasePath,
    SECRET_KEY: randomBytes(32).toString('hex'),
    COOKIE_PREFIX: `torsher_stand_${apiPort}`,
    ENGINE_PATH: '',
    ENGINE_PEER_PORT: '0',
    DOWNLOADS_PATH: '',
    LIBRARY_PATH: '',
    // Копия одноразовая: бэкап перед миграциями ветки ей не нужен
    TORSHER_SKIP_PRE_UPDATE_BACKUP: '1',
  }
  const serverDir = join(checkout, 'apps/server')

  if (!flags.empty) {
    const source = sourceData(serverEnv)
    const owner = readOwner(source.databasePath)

    if (!owner)
      fail('В dev-базе нет аккаунта: поднимите стенд с --empty')

    if (
      normalizeUsername(owner.username) === normalizeUsername(username)
      || (await verifyPassword(password, owner.passwordHash))
    ) {
      fail(
        'Учётка из .env.stand совпадает с настоящей учёткой dev-базы: задайте в нём другие имя пользователя и пароль',
      )
    }

    if (flags.files) {
      const size
        = (await dirSize(source.downloadsPath))
          + (await dirSize(source.libraryPath))

      console.log(
        `Клонирую загрузки и библиотеку (${formatSize(size)}; без поддержки клонов в ФС — полная копия)`,
      )
    }

    await copyData(source, stand, flags.files)
    sanitizeDb(stand.databasePath, source, stand, username)

    if (
      !runSync(process.execPath, ['src/cli.ts', 'reset-password', '--stdin'], {
        cwd: serverDir,
        env,
        input: password,
      })
    ) {
      fail('Не удалось задать тестовый пароль в копии базы')
    }
  }

  // Движок из исходников этой ветки
  runSync(process.execPath, ['scripts/engineBuild.ts', '--optional'], {
    cwd: serverDir,
    env,
  })

  // Клиентам — без окружения сервера: прокси и `NODE_OPTIONS` им не нужны
  const clientEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NUXT_PROXY_URL: urls.api,
    NUXT_PUBLIC_TV_URL: `${urls.tv}/`,
    TORSHER_API_URL: urls.api,
    TORSHER_PANEL_URL: urls.panel,
  }
  const bin = (app: string, name: string) =>
    join(checkout, 'apps', app, 'node_modules/.bin', name)
  state.pids = {
    server: start(
      'server',
      process.execPath,
      ['--watch', 'src/main.ts'],
      serverDir,
      env,
    ),
    panel: start(
      'panel',
      bin('web', 'nuxt'),
      ['dev', '--port', String(panelPort), '--strictPort'],
      join(checkout, 'apps/web'),
      clientEnv,
    ),
    tv: start(
      'tv',
      bin('tv', 'vite'),
      ['--port', String(tvPort), '--strictPort'],
      join(checkout, 'apps/tv'),
      clientEnv,
    ),
  }
  await writeState(state)
  console.log('Жду, пока стенд ответит…')

  const error = await waitReady(
    [`${urls.api}/api/health`, urls.panel, urls.tv],
    Object.values(state.pids),
  )

  if (error) {
    await printLogTails()
    fail(`Стенд не поднялся: ${error}`)
  }

  printState(state)
}

if (flags.stop) {
  await stopStand()
}
else {
  try {
    await startStand()
  }
  catch (err) {
    await removeStand()

    if (!(err instanceof StandError))
      throw err

    console.error(err.message)
    process.exitCode = 1
  }
}
