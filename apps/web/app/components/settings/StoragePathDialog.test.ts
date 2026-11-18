import type { Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { messages } from '@torsher/i18n'
import ts from 'typescript'
import * as vee from 'vee-validate'
import { expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { createI18n } from 'vue-i18n'
import { compileScript, parse } from 'vue/compiler-sfc'
import { formatBytes } from '~/lib/format'

it.each([
  ['en_US', 'Move'],
  ['ru_RU', 'Перенести'],
] as const)(
  'shows measured bytes only when known and keeps new-only submit available in %s',
  async (locale, move) => {
    let available = true
    let size = 10
    const checkPath = vi.fn(async (_kind: string, path: string) => ({
      path,
      problem: null,
      exists: true,
      writable: true,
      total: 100,
      free: 100,
      sameVolume: false,
      linkMode: 'copy',
      moveBytes: size,
      moveTotalBytes: size,
      moveItems: 1,
      moveAvailable: available,
    }))
    const changePath = vi.fn()
    let form!: ReturnType<typeof vee.useForm>
    const source = readFileSync(
      new URL('./StoragePathDialog.vue', import.meta.url),
      'utf8',
    ).replace(
      '<script setup lang="ts">',
      '<script setup lang="ts">\nimport { computed, ref, shallowRef, watch } from "vue"',
    )
    const { descriptor } = parse(source)
    const compiled = compileScript(descriptor, { id: 'storage-path-dialog' })
    const code = ts.transpileModule(compiled.content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    const exports: { default?: Component } = {}
    const require = createRequire(import.meta.url)
    const i18n = createI18n({ legacy: false, locale, messages })
    const load = (id: string) => {
      if (id === 'vue')
        return vue
      if (id === 'vee-validate') {
        return {
          ...vee,
          useForm: (...args: Parameters<typeof vee.useForm>) =>
            (form = vee.useForm(...args)),
        }
      }
      if (id === '@vueuse/core')
        return { useDebounceFn: (fn: unknown) => fn }
      if (id === 'vue-i18n')
        return { useI18n: () => i18n.global }
      if (id === 'vue-sonner')
        return { toast: { success() {} } }
      if (id === '~/lib/utils')
        return { cn: (...values: string[]) => values.join(' ') }
      if (id === '~/lib/format')
        return { formatBytes }
      if (id.startsWith('@/') || id.startsWith('~/') || id === '@lucide/vue')
        return {}
      return require(id)
    }
    // Compile the real local SFC and run its form/watchers; no browser or Nuxt server.
    // eslint-disable-next-line no-new-func
    new Function('require', 'exports', 'useStorage', 'useHeldLoading', code)(
      load,
      exports,
      () => ({ checkPath, changePath }),
      (fn: () => boolean) => vue.computed(fn),
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
    const folder = { path: '/old', source: 'env', envPath: '/old' }
    const app = renderer.createApp(
      { ...exports.default, render: () => null },
      {
        open: true,
        kind: 'downloads',
        overview: {
          folders: { downloads: folder },
          library: { linkMode: 'hardlink' },
        },
      },
    )
    app.mount({})
    const vm = (app as unknown as { _instance: { setupState: unknown } })
      ._instance
      .setupState as {
      canSubmit: boolean
      options: { value: string, title: string, disabled: boolean }[]
      runCheck: (path: string) => Promise<void>
      onSubmit: () => Promise<void>
    }
    try {
      form.setFieldValue('path', '/new')
      await vi.waitFor(() => expect(vm.canSubmit).toBe(true))
      form.setFieldValue('mode', 'move')
      await vue.nextTick()
      expect(
        vm.options.find(option => option.value === 'move'),
      ).toMatchObject({
        disabled: false,
        title: `${move} ${formatBytes(10, locale)}`,
      })
      size = 0
      await vm.runCheck('/new')
      await vue.nextTick()
      expect(
        vm.options.find(option => option.value === 'move'),
      ).toMatchObject({
        disabled: false,
        title: `${move} ${formatBytes(0, locale)}`,
      })
      available = false
      await vm.runCheck('/new')
      await vue.nextTick()
      expect(
        vm.options.find(option => option.value === 'move'),
      ).toMatchObject({
        disabled: true,
        title: move,
      })
      expect(form.values.mode).toBe('new_only')
      expect(vm.canSubmit).toBe(true)
      await vm.onSubmit()
      expect(changePath).toHaveBeenCalledWith({
        kind: 'downloads',
        path: '/new',
        mode: 'new_only',
      })
    }
    finally {
      app.unmount()
    }
  },
)
