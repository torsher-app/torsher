import type { Component, VNode } from 'vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { expect, it } from 'vitest'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as vee from 'vee-validate'
import { useForm } from 'vee-validate'

// Compile the real SFC without Nuxt or a browser. Only visual children are stubs;
// the field, its template event binding and vee-validate run unchanged.
function component() {
  const source = readFileSync(
    new URL('./ChannelField.vue', import.meta.url),
    'utf8',
  ).replace(
    '<script setup lang="ts">',
    '<script setup lang="ts">\nimport { computed, watch } from "vue"',
  )
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, {
    id: 'channel-field',
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
    if (id === 'vee-validate')
      return vee
    if (id === 'vue')
      return vue
    if (id === 'vue-i18n')
      return { useI18n: () => ({ t: (key: string) => key }) }
    if (id.startsWith('@/') || id.startsWith('~/')) {
      return new Proxy(
        { __esModule: true, default: stub },
        { get: (target, key) => Reflect.get(target, key) ?? stub },
      )
    }
    return require(id)
  }
  // Generated local SFC code only; no remote or user-provided input.
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', code)(load, exports)
  return exports.default!
}

it('keeps edited numeric channel fields string-valued for validation and submit', async () => {
  let form!: ReturnType<typeof useForm>
  let field!: VNode
  const Field = component()
  const Parent = vue.defineComponent({
    setup() {
      form = useForm({
        initialValues: { config: { port: '587' } },
        validationSchema: {
          'config.port': (value: unknown) =>
            typeof value === 'string' || 'Expected a string',
        },
      })
      return () =>
        (field = vue.h(Field, { name: 'port', label: 'Port', type: 'number' }))
    },
  })
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
  const app = renderer.createApp(Parent)
  app.mount({})
  try {
    const findInput = (node: VNode): VNode | undefined => {
      if (
        node.props?.id === 'channel-port'
        && ('modelValue' in node.props || 'model-value' in node.props)
      ) {
        return node
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (typeof child === 'object' && child && 'type' in child) {
            const found = findInput(child as VNode)
            if (found)
              return found
          }
        }
      }
    }
    const input = () => findInput(field.component!.subTree)!
    expect(input().props?.modelValue ?? input().props?.['model-value']).toBe(
      '587',
    )
    for (const next of [19125, '', 1, 65535, '587']) {
      input().props!['onUpdate:modelValue'](next)
      await vue.nextTick()
      expect(form.values.config.port).toBe(String(next))
      expect((await form.validate()).valid).toBe(true)
      const submit = form.handleSubmit(values => values.config.port)
      expect(await submit()).toBe(String(next))
    }
  }
  finally {
    app.unmount()
  }
})
