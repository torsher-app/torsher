import type { Rolldown } from 'vite'
import { fileURLToPath } from 'node:url'
import { PSEUDO_PAD } from '@torsher/i18n/pseudo'
import { build } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findLegacyApis, legacyApiGuard } from './legacyApiGuard.ts'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

function apis(code: string) {
  return findLegacyApis(code).map(violation => violation.api)
}

describe('findLegacyApis', () => {
  it.each([
    ['AbortSignal.any', 'n.signal=AbortSignal.any(o)'],
    ['AbortSignal.timeout', 'fetch(u,{signal:AbortSignal.timeout(1e4)})'],
    ['AbortSignal.reason', 'r(t.reason)'],
    ['structuredClone', 'let a=structuredClone(e)'],
    ['Object.hasOwn', 'if(Object.hasOwn(t,n))'],
    ['Array.prototype.at', 'n.signal=o.at(-1)'],
    ['String.prototype.replaceAll', 'e.replaceAll(fg,``)'],
    ['Promise.any', 'Promise.any(e)'],
    ['Promise.allSettled', 'Promise.allSettled(e)'],
    ['Object.fromEntries', 'return Object.fromEntries(n)'],
    ['String.prototype.matchAll', 'for(let t of e.matchAll(r));'],
    ['queueMicrotask', 'queueMicrotask(()=>{})'],
    ['Array.prototype.flat', 'e.flat()'],
    ['Array.prototype.flatMap', 'e.flatMap(t=>t)'],
    ['Array.prototype.findLast', 'e.findLast(t=>t)'],
    ['Array.prototype.findLastIndex', 'e.findLastIndex(t=>t)'],
    ['Array.prototype.toReversed', 'e.toReversed()'],
    ['Array.prototype.toSorted', 'e.toSorted()'],
    ['Array.prototype.toSpliced', 'e.toSpliced(0,1)'],
  ])('находит %s', (api, code) => {
    expect(apis(code)).toEqual([api])
  })

  it('пропускает обёртки массивов реактивности Vue', () => {
    const code
      = 'findLast(e,t){return ft(this,`findLast`,e,t,e=>dt(this,e),arguments)},'
        + 'toReversed(){return at(this).toReversed()},toSorted(e){return at(this).toSorted(e)},'
        + 'toSpliced(...e){return at(this).toSpliced(...e)}'

    expect(apis(code)).toEqual([])
  })

  it('находит вызов из приложения рядом с обёрткой Vue', () => {
    expect(
      apis('toSorted(e){return at(this).toSorted(e)};let s=list.toSorted()'),
    ).toEqual(['Array.prototype.toSorted'])
  })

  it('пропускает globalThis под typeof и сразу после такой проверки', () => {
    const code
      = 'ue=()=>le||(le=typeof globalThis<`u`?globalThis:typeof self<`u`?self:window);'
        + 'if(typeof globalThis!==\'undefined\'&&globalThis.Intl);e.globalThis=1'

    expect(apis(code)).toEqual([])
  })

  it('пропускает globalThis внутри выражения под проверкой', () => {
    const code
      = 'typeof window<`u`&&window.performance?(xp=!0,Sp=window.performance):'
        + 'typeof globalThis<`u`&&(e=globalThis.perf_hooks)!=null&&e.performance'
        + '?(xp=!0,Sp=globalThis.perf_hooks.performance):xp=!1'

    expect(apis(code)).toEqual([])
  })

  it('находит globalThis без проверки и typeof globalThis.X', () => {
    expect(apis('e instanceof globalThis.Request')).toEqual([
      'globalThis без typeof',
    ])
    expect(apis('wm=typeof globalThis.AbortSignal==`function`')).toEqual([
      'globalThis без typeof',
    ])
  })

  it('находит globalThis за границей проверки', () => {
    expect(apis('typeof globalThis<`u`?a:globalThis')).toEqual([
      'globalThis без typeof',
    ])
    expect(apis('typeof globalThis<`u`&&a,globalThis.b')).toEqual([
      'globalThis без typeof',
    ])
    expect(apis('(typeof globalThis<`u`&&a)||globalThis.b')).toEqual([
      'globalThis без typeof',
    ])
    expect(apis('typeof globalThis===`undefined`?globalThis.a:b')).toEqual([
      'globalThis без typeof',
    ])
  })

  it('пропускает поле `reason` у своих объектов и результатов allSettled', () => {
    expect(apis('this.retryDate=1/0,t.reason=`offline`;return')).toEqual([])
    expect(
      apis('for(let e of t||[])e.status===`rejected`&&i(e.reason);return e()'),
    ).toEqual([])
    // Чтение поля сигнала по-прежнему нарушение
    expect(apis('r(t.reason);t.reason==null')).toEqual([
      'AbortSignal.reason',
      'AbortSignal.reason',
    ])
  })

  it('не путает похожие имена', () => {
    expect(
      apis(
        'e.reasonable;e.format(x);e.flatten(y);Object.hasOwnProperty.call(a,b)',
      ),
    ).toEqual([])
  })
})

describe('legacyApiGuard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('роняет сборку, если в бандле есть свежий API', async () => {
    const entry = 'virtual:entry'

    await expect(
      build({
        configFile: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'entry',
            resolveId: id => (id === entry ? id : undefined),
            load: id =>
              id === entry
                ? 'document.title = String(Object.hasOwn(window, \'x\'))'
                : undefined,
          },
          legacyApiGuard(),
        ],
        build: {
          write: false,
          target: 'chrome68',
          rolldownOptions: { input: entry },
        },
      }),
    ).rejects.toThrow(/Object\.hasOwn: есть с Chromium 93/)
  })

  it('пропускает бандл витрины, псевдолокали в нём нет', async () => {
    // vitest выставляет NODE_ENV=test, и Vite собрал бы dev-вариант зависимостей
    vi.stubEnv('NODE_ENV', 'production')

    const result = await build({
      root: appRoot,
      logLevel: 'silent',
      build: { write: false },
    })
    const outputs = (
      Array.isArray(result) ? result : [result]
    ) as Rolldown.RolldownOutput[]
    const code = outputs
      .flatMap(({ output }) => output)
      .map(file => (file.type === 'chunk' ? file.code : ''))
      .join('\n')

    // Не toContain: при провале он вывел бы в отчёт весь бандл
    expect(code.includes('Subtitles')).toBe(true)
    expect(code.includes(PSEUDO_PAD), 'псевдолокаль попала в бандл').toBe(
      false,
    )
  }, 60_000)
})
