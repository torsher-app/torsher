import type { Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { formatDateTime } from '../../lib/format'

function mountCard() {
  const getExternalLists = vi.fn()
  const profileState = vue.ref('idle')
  const loadProfiles = vi.fn(() => {
    profileState.value = 'ready'
  })
  const locale = vue.ref('en_US')
  const source = readFileSync(
    new URL('./ExternalListsCard.vue', import.meta.url),
    'utf8',
  )
    .split('</script>')[0]!
    .replace(
      '<script setup lang="ts">',
      '<script setup lang="ts">\nimport { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue"',
    )
  const { descriptor } = parse(
    `${source}\ndefineExpose({ load, runTime })\n</script>`,
  )
  const { content } = compileScript(descriptor, { id: 'external-lists-card' })
  const code = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: { default?: Component & { render?: () => null } } = {}
  const require = createRequire(import.meta.url)
  const load = (module: string) => {
    switch (module) {
      case 'vue':
        return vue
      case 'vue-i18n':
        return { useI18n: () => ({ t: (key: string) => key, locale }) }
      case '@torsher/api-client':
        return { getErrorStatus: () => 503 }
      case '~/services/api':
        return { api: { settings: { getExternalLists } } }
      case '~/lib/format':
        return { formatDateTime }
      case '~/lib/externalLists':
        return { externalListRequestError: () => 'error' }
      default:
        return module.startsWith('@/')
          || module.startsWith('~/')
          || module.endsWith('.vue')
          ? {}
          : require(module)
    }
  }

  // Compile the actual SFC's setup; only the renderer and API are replaced.
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', 'useProfiles', 'withErrorMode', code)(
    load,
    exports,
    () => ({
      profiles: vue.shallowRef([]),
      state: profileState,
      load: loadProfiles,
    }),
    (_mode: string, action: () => unknown) => action(),
  )
  exports.default!.render = () => null
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
  const app = renderer.createApp(exports.default!)
  getExternalLists.mockRejectedValueOnce(new Error('temporary failure'))
  const card = app.mount({}) as unknown as {
    load: () => Promise<void>
    runTime: (value: number) => string
  }
  return { app, card, locale, loadProfiles, getExternalLists }
}

it('loads profiles when retry recovers an unavailable settings request', async () => {
  const { app, card, loadProfiles, getExternalLists } = mountCard()
  try {
    expect(loadProfiles).not.toHaveBeenCalled()
    getExternalLists.mockResolvedValue({
      hasKey: true,
      keyRejected: false,
      lists: [],
    })
    await card.load()
    expect(loadProfiles).toHaveBeenCalledTimes(1)
  }
  finally {
    app.unmount()
  }
})

it('formats the schedule in both panel locales', () => {
  const { app, card, locale } = mountCard()
  try {
    const time = Date.UTC(2026, 10, 28, 4)
    expect(card.runTime(time)).toBe(
      formatDateTime(new Date(time).toISOString(), 'en_US'),
    )
    locale.value = 'ru_RU'
    expect(card.runTime(time)).toBe(
      formatDateTime(new Date(time).toISOString(), 'ru_RU'),
    )
  }
  finally {
    app.unmount()
  }
})
