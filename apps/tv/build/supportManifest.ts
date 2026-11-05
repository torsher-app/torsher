import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Separate asset avoids recursive hashing. Read bytes after Rolldown writes its final output. */
export function supportManifest(tvBuildId: string): Plugin {
  return {
    name: 'torsher:support-manifest',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options, bundle) {
      if (!options.dir)
        return
      const assets: Record<string, string> = {}
      for (const [name, entry] of Object.entries(bundle)) {
        if (entry.type === 'chunk' && name.endsWith('.js')) {
          const bytes = await readFile(resolve(options.dir, name))
          assets[name] = createHash('sha256').update(bytes).digest('hex')
        }
      }
      await writeFile(
        resolve(options.dir, 'support-assets.json'),
        JSON.stringify({ version: 1, tvBuildId, assets }),
      )
    },
  }
}
