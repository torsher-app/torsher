import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { supportManifest } from './supportManifest.ts'

it('hashes actual final emitted JS bytes, including writer formatting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'torsher-support-manifest-'))
  try {
    await writeFile(
      join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>',
    )
    await writeFile(
      join(root, 'main.js'),
      'document.body.textContent = "fixture"',
    )
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [supportManifest('exact-build')],
      build: { outDir: join(root, 'dist') },
    })
    const manifest = JSON.parse(
      await readFile(join(root, 'dist/support-assets.json'), 'utf8'),
    )
    expect(manifest).toMatchObject({ version: 1, tvBuildId: 'exact-build' })
    expect(Object.keys(manifest.assets)).toHaveLength(1)
    for (const [name, hash] of Object.entries(manifest.assets)) {
      const bytes = await readFile(join(root, 'dist', name))
      expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
