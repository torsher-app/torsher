import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { androidString, resourceFiles, stringsXml } from './strings.ts'

describe('androidString', () => {
  it('turns placeholders into positional arguments', () => {
    expect(androidString('Connecting to {address}')).toBe('Connecting to %1$s')
  })

  it('escapes what Android resources treat specially', () => {
    expect(androidString('isn\'t "ok" 100% <b> & co')).toBe(
      'isn\\\'t \\"ok\\" 100%% &lt;b&gt; &amp; co',
    )
    expect(androidString('@home')).toBe('\\@home')
  })
})

describe('stringsXml', () => {
  it('names nested keys in snake case under shell_', () => {
    expect(
      stringsXml({ addressLabel: 'Address', errors: { notTorsher: 'No' } }),
    ).toContain('<string name="shell_errors_not_torsher">No</string>')
  })
})

describe('resource files', () => {
  it('match @torsher/i18n: run `pnpm strings` after changing shell.*', () => {
    for (const { path, content } of resourceFiles()) {
      expect(existsSync(path), path).toBe(true)
      expect(readFileSync(path, 'utf8'), path).toBe(content)
    }
  })
})
