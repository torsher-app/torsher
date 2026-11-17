import type { Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import * as vue from 'vue'

// Keep compiler imports separate from the generated module loader.
import {
  compileScript as compileSource,
  parse as parseSource,
} from 'vue/compiler-sfc'

// Exercise the real card handler and form; only visual children and API/toasts
// are replaced. Compile the SFC as in the other panel component tests.
function mountCard() {
  const checkTmdbKey = vi.fn()
  const saveTmdbKey = vi.fn()
  const toast = { success: vi.fn(), error: vi.fn() }
  const source = readFileSync(
    new URL('./MetadataKeyCard.vue', import.meta.url),
    'utf8',
  )
    .replace(
      '<script setup lang="ts">',
      '<script setup lang="ts">\nimport { computed, ref, watch } from "vue"',
    )
    .replace('</script>', '\ndefineExpose({ onCheck, isChecking })\n</script>')
  const { descriptor } = parseSource(source)
  const compiled = compileSource(descriptor, {
    id: 'metadata-key-card',
    inlineTemplate: true,
  })
  const code = ts.transpileModule(compiled.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: { default?: Component } = {}
  const require = createRequire(import.meta.url)
  const stub = vue.defineComponent({ setup: () => () => null })
  const load = (id: string) => {
    if (id === 'vue')
      return vue
    if (id === 'vue-sonner')
      return { toast }
    if (id === 'vue-i18n')
      return { useI18n: () => ({ t: (key: string) => key }) }
    if (
      id.startsWith('@/')
      || id.startsWith('~/')
      || id.endsWith('.vue')
      || id === '@lucide/vue'
    ) {
      return new Proxy(
        { __esModule: true, default: stub },
        { get: (target, key) => Reflect.get(target, key) ?? stub },
      )
    }
    return require(id)
  }
  // Generated local SFC code only.
  // eslint-disable-next-line no-new-func
  new Function(
    'require',
    'exports',
    'useMetadataSettings',
    'withErrorMode',
    code,
  )(
    load,
    exports,
    () => ({ checkTmdbKey, saveTmdbKey }),
    (_mode: string, action: () => unknown) => action(),
  )
  const renderer = vue.createRenderer<object, object>({
    patchProp() {},
    insert() {},
    remove() {},
    setElementText() {},
    setText() {},
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp(exports.default!, {
    settings: { tmdb: { source: 'custom', defaultKey: 'env' } },
  })
  const card = app.mount({}) as unknown as {
    onCheck: () => Promise<void>
    isChecking: boolean
  }
  return {
    card,
    checkTmdbKey,
    saveTmdbKey,
    toast,
    unmount: () => app.unmount(),
  }
}

it('reports repeated transport failures after success and always restores the check button', async () => {
  const { card, checkTmdbKey, saveTmdbKey, toast, unmount } = mountCard()
  try {
    checkTmdbKey.mockResolvedValueOnce({ ok: true, kind: null })
    await card.onCheck()
    expect(toast.success).toHaveBeenCalledWith(
      'panel.settings.metadata.check.ok',
    )
    for (const name of ['TimeoutError', 'TimeoutError', 'TypeError']) {
      let fail!: (error: Error) => void
      checkTmdbKey.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject
          }),
      )
      const pending = card.onCheck()
      expect(card.isChecking).toBe(true)
      fail(Object.assign(new Error('transport failed'), { name }))
      await expect(pending).resolves.toBeUndefined()
      expect(card.isChecking).toBe(false)
      expect(toast.error).toHaveBeenLastCalledWith(
        'panel.settings.metadata.check.unavailable',
      )
    }
    expect(toast.error).toHaveBeenCalledTimes(3)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(checkTmdbKey).toHaveBeenLastCalledWith(undefined)
    expect(saveTmdbKey).not.toHaveBeenCalled()
  }
  finally {
    unmount()
  }
})

it.each(['rejected', 'missing', 'unavailable'])(
  'preserves the server result %s',
  async (kind) => {
    const { card, checkTmdbKey, toast, unmount } = mountCard()
    try {
      checkTmdbKey.mockResolvedValueOnce({ ok: false, kind })
      await card.onCheck()
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        `panel.settings.metadata.check.${kind}`,
      )
      expect(card.isChecking).toBe(false)
    }
    finally {
      unmount()
    }
  },
)
