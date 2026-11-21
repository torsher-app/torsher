import type { Component } from 'vue'
import type { Profile, ProfileMoveConflict } from '@torsher/api-client'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as client from '@torsher/api-client'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

afterEach(() => vi.unstubAllGlobals())

function subject() {
  const source = readFileSync(
    new URL('./DeleteProfileDialog.vue', import.meta.url),
    'utf8',
  ).replace(
    '<script setup lang="ts">',
    '<script setup lang="ts">\nimport { ref, computed, watch } from "vue"',
  )
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'delete-profile' })
  const code = ts.transpileModule(compiled.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: { default?: Component } = {}
  const require = createRequire(import.meta.url)
  const success = vi.fn()
  const api = client.createApiClient({
    getErrorMode: () => 'silent',
    onSessionExpired() {},
    onError() {},
    onFatal() {},
  })
  const profiles = vue.ref([
    { id: 'source', name: 'Source' },
    { id: 'target', name: 'Target' },
  ] as Profile[])
  const remove = vi.fn(async (id: string, moveTo: string | undefined) => {
    await api.profiles.deleteProfile(id, moveTo ? { moveTo } : {})
    profiles.value = profiles.value.filter(item => item.id !== id)
  })
  const load = (id: string) => {
    if (id === 'vue')
      return vue
    if (id === '@torsher/api-client')
      return client
    if (id === 'vue-i18n')
      return { useI18n: () => ({ t: (key: string) => key }) }
    if (id === 'vue-sonner')
      return { toast: { success } }
    if (
      id.startsWith('@/')
      || id.startsWith('~/')
      || id.endsWith('.vue')
      || id === '@lucide/vue'
    ) {
      return {}
    }
    return require(id)
  }
  // Compile the real local SFC setup; no remote code or browser is involved.
  // eslint-disable-next-line no-new-func
  new Function(
    'require',
    'exports',
    'useProfiles',
    'useLastValue',
    'withErrorMode',
    code,
  )(
    load,
    exports,
    () => ({ profiles, remove }),
    (getter: () => unknown) => vue.computed(getter),
    (_mode: string, fn: () => Promise<unknown>) => fn(),
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
  const app = renderer.createApp(
    { ...exports.default, render: () => null },
    {
      open: true,
      profile: profiles.value[0],
    },
  )
  const closed = vi.fn()
  app._props!['onUpdate:open'] = closed
  app.mount({})
  const vm = (app as unknown as { _instance: { setupState: unknown } })
    ._instance
    .setupState as {
    targetId: string
    formError: string
    isDeleting: boolean
    onDelete: () => Promise<void>
  }
  vm.targetId = 'target'
  return {
    vm,
    profiles,
    success,
    closed,
    remove,
    dispose: () => app.unmount(),
  }
}

it.each<ProfileMoveConflict['reason']>([
  'originTitle',
  'originEpisode',
  'cycleIdentity',
])(
  'keeps both profiles and the dialog open on a %s move conflict, then allows retry',
  async (reason) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ kind: 'personalMoveConflict', reason }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const test = subject()
    try {
      await test.vm.onDelete()
      expect(test.vm.formError).toBe(
        reason === 'originTitle'
          ? 'panel.people.deleteDialog.moveConflict'
          : 'panel.people.deleteDialog.moveConflictOther',
      )
      expect(test.profiles.value.map(item => item.id)).toEqual([
        'source',
        'target',
      ])
      expect(test.success).not.toHaveBeenCalled()
      expect(test.closed).not.toHaveBeenCalled()
      expect(test.vm.isDeleting).toBe(false)

      await test.vm.onDelete()
      expect(test.vm.formError).toBe('')
      expect(test.profiles.value.map(item => item.id)).toEqual(['target'])
      expect(test.success).toHaveBeenCalledOnce()
      expect(test.closed).toHaveBeenCalledWith(false)
      expect(test.remove).toHaveBeenNthCalledWith(2, 'source', 'target')
    }
    finally {
      test.dispose()
    }
  },
)
