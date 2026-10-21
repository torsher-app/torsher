import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rqbitAssetFor, rqbitDownloadUrl } from './release.ts'

const dockerfile = readFileSync(
  join(import.meta.dirname, '../../../../../Dockerfile'),
  'utf8',
)

// Образ скачивает движок сам: адрес и сумма в Dockerfile должны совпадать
// с закреплёнными здесь, иначе образ и `engine:install` разойдутся в версиях
describe('rqbit в Dockerfile', () => {
  it.each(['x64', 'arm64'])('linux-%s — тот же адрес и сумма', (arch) => {
    const asset = rqbitAssetFor('linux', arch)!

    expect(dockerfile).toContain(
      `ADD --checksum=sha256:${asset.sha256} \\\n    --chmod=755 \\\n    ${rqbitDownloadUrl(asset)} /rqbit`,
    )
  })
})
