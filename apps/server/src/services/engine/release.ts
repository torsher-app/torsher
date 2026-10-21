import { join } from 'node:path'
import process from 'node:process'
import { config } from '../../config.ts'

/**
 * Закреплённый релиз движка: API и флаги адаптера проверены на этой версии.
 * Новая версия — новые адреса и контрольные суммы со страницы релиза.
 */
export const RQBIT_VERSION = '9.0.1'

export interface RqbitAsset {
  name: string
  sha256: string
}

// Ключ — `${process.platform}-${process.arch}`
const ASSETS: Record<string, RqbitAsset> = {
  'linux-x64': {
    name: 'rqbit-linux-amd64',
    sha256: '82ed2c23f4c7b91bb2c92eaab92e4a850d386cdf337bcdf9e0971c8ce3da4335',
  },
  'linux-arm64': {
    name: 'rqbit-linux-arm64',
    sha256: '9ac50a7d1917cd458111265a12346a924b4f7cea7520327782ed5bd6f423b561',
  },
  'linux-arm': {
    name: 'rqbit-linux-arm-v7',
    sha256: '576817c66361ce70159cd18ec7d2bf329c94816b72a12d6da821428f93ba0230',
  },
  'darwin-x64': {
    name: 'rqbit-osx-universal',
    sha256: 'de8b957b2927dc5bf911506bf3c24c8e77e24a6d21ecd80f6fcffd2db30eb672',
  },
  'darwin-arm64': {
    name: 'rqbit-osx-universal',
    sha256: 'de8b957b2927dc5bf911506bf3c24c8e77e24a6d21ecd80f6fcffd2db30eb672',
  },
  'win32-x64': {
    name: 'rqbit.exe',
    sha256: '2ed683203beca628e0c45f62f99feeef4242cecc3444c8422dfe5b1b6aa38cea',
  },
}

export function rqbitAssetFor(platform: string, arch: string) {
  return ASSETS[`${platform}-${arch}`]
}

export function rqbitDownloadUrl(asset: RqbitAsset) {
  return `https://github.com/ikatson/rqbit/releases/download/v${RQBIT_VERSION}/${asset.name}`
}

/** Куда `engine:install` кладёт бинарник; версия в имени — старый не подхватится */
export function installedRqbitPath() {
  const suffix = process.platform === 'win32' ? '.exe' : ''

  return join(config.dataDir, 'engine', `rqbit-${RQBIT_VERSION}${suffix}`)
}

export function rqbitBinaryPath() {
  return config.rqbitPath ?? installedRqbitPath()
}
