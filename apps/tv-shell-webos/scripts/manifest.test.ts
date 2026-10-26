import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildManifest, ipkFileName, repositoryUrl } from './manifest.ts'

const app = {
  id: 'app.torsher.webos',
  version: '1.2.3',
  type: 'web',
  title: 'Torsher',
  appDescription: 'Showcase',
}

describe('webOS manifest', () => {
  it('names the IPK the way ares-package does', () => {
    expect(ipkFileName(app)).toBe('app.torsher.webos_1.2.3_all.ipk')
  })

  it('turns the npm repository field into a GitHub URL', () => {
    expect(repositoryUrl('git+https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo',
    )
  })

  it('describes the IPK next to it with its size and hash', () => {
    const ipk = new TextEncoder().encode('ipk bytes')
    const manifest = buildManifest(app, ipk, 'https://github.com/owner/repo')

    expect(manifest).toEqual({
      ...app,
      iconUri:
        'https://raw.githubusercontent.com/owner/repo/v1.2.3/apps/tv-shell-webos/public/icon-130.png',
      sourceUrl: 'https://github.com/owner/repo',
      rootRequired: false,
      ipkUrl: 'app.torsher.webos_1.2.3_all.ipk',
      ipkSize: ipk.byteLength,
      ipkHash: { sha256: createHash('sha256').update(ipk).digest('hex') },
    })
  })
})
