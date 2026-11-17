import type { Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { expect, it } from 'vitest'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as vee from 'vee-validate'
import * as channels from '../../lib/notificationChannels'

// Exercise the real dialog setup and vee-validate, without Nuxt or DOM children.
function dialog() {
  const source = readFileSync(
    new URL('./ChannelDialog.vue', import.meta.url),
    'utf8',
  ).replace(
    '<script setup lang="ts">',
    '<script setup lang="ts">\nimport { ref, computed, watch } from "vue"',
  )
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'channel-dialog' })
  const code = ts.transpileModule(compiled.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: { default?: Component } = {}
  const require = createRequire(import.meta.url)
  let form!: ReturnType<typeof vee.useForm>
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
    if (id === 'vue-sonner')
      return { toast: { success() {} } }
    if (id === 'vue-i18n') {
      return {
        useI18n: () => ({ t: (key: string) => key, locale: vue.ref('en_US') }),
      }
    }
    if (id === '~/lib/notificationChannels')
      return channels
    if (id.startsWith('@/') || id.startsWith('~/') || id.endsWith('.vue'))
      return {}
    return require(id)
  }
  // Generated local SFC only, no user or remote input.
  // eslint-disable-next-line no-new-func
  new Function(
    'require',
    'exports',
    'useNotificationChannels',
    'useRuntimeConfig',
    'window',
    code,
  )(
    load,
    exports,
    () => ({
      kinds: vue.ref(channels.channelKindOrder),
      save() {},
      testDraft() {},
    }),
    () => ({ app: { baseURL: '/panel/' } }),
    { location: { origin: 'http://panel.example' } },
  )
  return {
    component: { ...exports.default, render: () => null },
    form: () => form,
  }
}

it('replaces nested provider defaults and discards prior draft fields for every kind transition', async () => {
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
  const subject = dialog()
  const app = renderer.createApp(subject.component, { open: true })
  app.mount({})
  const vm = (app as unknown as { _instance: { setupState: unknown } })
    ._instance
    .setupState as {
    start: (kind: (typeof channels.channelKindOrder)[number]) => void
    values: { config: Record<string, string> }
    bodyOf: (values: unknown) => { config: Record<string, string> }
  }
  try {
    for (const previous of channels.channelKindOrder) {
      for (const next of channels.channelKindOrder) {
        vm.start(previous)
        await vue.nextTick()
        // Include shared names (server, token, username, password) and private fields.
        for (const field of channels.channelFields[previous]) {
          subject
            .form()
            .setFieldValue(`config.${field}`, `draft-${previous}-${field}`)
        }
        vm.start(next)
        await vue.nextTick()
        expect(vm.values.config, `${previous} → ${next}`).toEqual(
          channels.channelDefaults[next],
        )
        expect(
          vm.bodyOf(vm.values).config,
          `${previous} → ${next} submit`,
        ).toEqual(channels.channelDefaults[next])
      }
    }
  }
  finally {
    app.unmount()
  }
})
