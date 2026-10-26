// Манифест для Homebrew Channel рядом с IPK: запускается после ares-package.
// Homebrew Channel скачивает IPK по ссылке рядом с манифестом и сверяет его
// sha256, поэтому манифест собирается заново на каждый IPK
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export interface AppInfo {
  id: string
  version: string
  type: string
  title: string
  appDescription: string
}

export interface WebosManifest extends AppInfo {
  iconUri: string
  sourceUrl: string
  rootRequired: false
  ipkUrl: string
  ipkSize: number
  ipkHash: { sha256: string }
}

export function ipkFileName({ id, version }: AppInfo) {
  return `${id}_${version}_all.ipk`
}

/** `git+https://github.com/owner/repo.git` → `https://github.com/owner/repo` */
export function repositoryUrl(url: string) {
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

export function buildManifest(
  app: AppInfo,
  ipk: Uint8Array,
  sourceUrl: string,
): WebosManifest {
  const raw = sourceUrl.replace(
    'https://github.com/',
    'https://raw.githubusercontent.com/',
  )

  return {
    id: app.id,
    version: app.version,
    type: app.type,
    title: app.title,
    appDescription: app.appDescription,
    // Иконка с тега релиза: ссылка на main поменялась бы вместе с веткой
    iconUri: `${raw}/v${app.version}/apps/tv-shell-webos/public/icon-130.png`,
    sourceUrl,
    rootRequired: false,
    // Относительная ссылка: IPK лежит в том же релизе, что и манифест
    ipkUrl: ipkFileName(app),
    ipkSize: ipk.byteLength,
    ipkHash: { sha256: createHash('sha256').update(ipk).digest('hex') },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const app = JSON.parse(
    readFileSync(join(root, 'dist/appinfo.json'), 'utf8'),
  ) as AppInfo
  const workspace = JSON.parse(
    readFileSync(join(root, '../../package.json'), 'utf8'),
  ) as {
    repository: { url: string }
  }
  const ipk = readFileSync(join(root, 'build', ipkFileName(app)))
  const manifest = buildManifest(
    app,
    ipk,
    repositoryUrl(workspace.repository.url),
  )
  const out = join(root, 'build', `${app.id}.manifest.json`)

  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Manifest: ${out}`)
}
