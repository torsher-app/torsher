/**
 * Checks what the VitePress build lets through: every `<Ui k>` names an
 * existing interface string (a failed render still exits 0), every page has a
 * title and a description for search engines and link previews, and every
 * documentation page is reachable from the sidebar.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { sidebar } from '../.vitepress/sidebar.ts'
import { label } from '../.vitepress/ui.ts'

const root = join(import.meta.dirname, '..')

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.')
        ? []
        : pages(path)
    }
    return entry.name.endsWith('.md') ? [path] : []
  })
}

function linkOf(file: string) {
  const path = `/${relative(root, file).replace(/\.md$/, '')}`
  return path.endsWith('/index') ? path.slice(0, -'index'.length) : path
}

function links(items: typeof sidebar): string[] {
  return items.flatMap(item => [
    ...(item.link ? [item.link] : []),
    ...(item.items ? links(item.items) : []),
  ])
}

const inSidebar = new Set(links(sidebar))
const problems: string[] = []

for (const file of pages(root)) {
  const name = relative(root, file)
  const source = readFileSync(file, 'utf8')
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? ''

  for (const field of ['title', 'description']) {
    if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(frontmatter))
      problems.push(`${name}: no ${field} in frontmatter`)
  }

  for (const [, keys] of source.matchAll(/<Ui k="([^"]+)"/g)) {
    for (const key of keys!.trim().split(/\s+/)) {
      try {
        label(key)
      }
      catch {
        problems.push(`${name}: unknown interface string "${key}"`)
      }
    }
  }

  if (name.startsWith('docs/') && !inSidebar.has(linkOf(file)))
    problems.push(`${name}: not in .vitepress/sidebar.ts`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log('Site pages are fine')
