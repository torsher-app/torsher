import type { Plugin } from 'vite'

// Минимальная платформа витрины — webOS 5. Полифиллов в сборке нет,
// поэтому любой API новее этой версии ломает витрину на ТВ.
const MIN_CHROMIUM = 68

interface LegacyApiRule {
  api: string
  since: number
  pattern: RegExp
  isAllowed?: (code: string, index: number) => boolean
}

export interface LegacyApiViolation {
  api: string
  since: number
  index: number
  snippet: string
}

const SNIPPET_RADIUS = 60

// Реактивность Vue проксирует методы массива обёртками вида
// `toSorted(e){return at(this).toSorted(e)}`: метод вызывается, только если
// его вызвало само приложение, поэтому разрешён лишь такой вызов.
function isVueArrayWrapper(code: string, index: number) {
  const name = /^\.([\w$]+)/.exec(code.slice(index))?.[1]
  if (!name)
    return false

  const before = code.slice(Math.max(0, index - 100), index)
  return new RegExp(`\\b${name}\\([^()]*\\)\\{return [\\w$]+\\(this\\)$`).test(
    before,
  )
}

// Проверка, что `globalThis` есть: `typeof globalThis<"u"`, `!=="undefined"`,
// `=="object"`, за ней `&&` или `?`
const GLOBAL_THIS_GUARD
  = /typeof\s+globalThis\s*(?:<|!==?|===?)\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*(?:&&|\?)/g
const GUARD_LOOKBEHIND = 300

function skipString(code: string, start: number) {
  const quote = code[start]
  let i = start + 1
  while (i < code.length && code[i] !== quote) i += code[i] === '\\' ? 2 : 1
  return i
}

// Код от проверки до `index` остаётся под её защитой, пока на том же уровне
// скобок не встретилась граница выражения: `;`, `,`, `:` ветки «иначе»,
// `||`, `??` или закрытие скобки, в которой стоит проверка.
function isInsideGuard(code: string, from: number, index: number) {
  let depth = 0

  for (let i = from; i < index; i++) {
    const char = code[i]!

    if (char === '"' || char === '\'' || char === '`') {
      i = skipString(code, i)
    }
    else if (char === '(' || char === '[' || char === '{') {
      depth++
    }
    else if (char === ')' || char === ']' || char === '}') {
      if (--depth < 0)
        return false
    }
    else if (depth === 0) {
      const pair = code.slice(i, i + 2)
      if (
        char === ';'
        || char === ','
        || char === ':'
        || pair === '||'
        || pair === '??'
      ) {
        return false
      }
    }
  }

  return true
}

// `typeof globalThis` безопасен, `typeof globalThis.X` без внешней проверки —
// нет: на Chromium 68 обращение к свойству бросает ReferenceError. Само
// значение допустимо под проверкой: `typeof globalThis<"u"?globalThis:…`,
// `typeof globalThis<"u"&&(e=globalThis.x)`.
function isGuardedGlobalThis(code: string, index: number) {
  const before = code.slice(Math.max(0, index - 10), index)
  const after = code.slice(index + 'globalThis'.length)

  if (/typeof\s+$/.test(before) && !/^\s*[.[]/.test(after))
    return true

  const windowStart = Math.max(0, index - GUARD_LOOKBEHIND)
  const lookbehind = code.slice(windowStart, index)

  return [...lookbehind.matchAll(GLOBAL_THIS_GUARD)]
    .filter(
      guard => !/^typeof\s+globalThis\s*===?\s*["'`]undefined/.test(guard[0]),
    )
    .some(guard =>
      isInsideGuard(code, windowStart + guard.index + guard[0].length, index),
    )
}

function methodRule(method: string, since: number): LegacyApiRule {
  return {
    api: method,
    since,
    pattern: new RegExp(`\\.${method.split('.').at(-1)}\\(`, 'g'),
  }
}

const RULES: LegacyApiRule[] = [
  { api: 'AbortSignal.any', since: 116, pattern: /\bAbortSignal\.any\b/g },
  {
    api: 'AbortSignal.timeout',
    since: 103,
    pattern: /\bAbortSignal\.timeout\b/g,
  },
  { api: 'AbortSignal.reason', since: 98, pattern: /\.reason\b/g },
  { api: 'structuredClone', since: 98, pattern: /\bstructuredClone\b/g },
  { api: 'Object.hasOwn', since: 93, pattern: /\bObject\.hasOwn\b/g },
  methodRule('Array.prototype.at', 92),
  methodRule('String.prototype.replaceAll', 85),
  { api: 'Promise.any', since: 85, pattern: /\bPromise\.any\b/g },
  { api: 'Promise.allSettled', since: 76, pattern: /\bPromise\.allSettled\b/g },
  { api: 'Object.fromEntries', since: 73, pattern: /\bObject\.fromEntries\b/g },
  methodRule('String.prototype.matchAll', 73),
  { api: 'queueMicrotask', since: 71, pattern: /\bqueueMicrotask\b/g },
  {
    api: 'globalThis без typeof',
    since: 71,
    pattern: /(?<![\w$.])globalThis\b/g,
    isAllowed: isGuardedGlobalThis,
  },
  methodRule('Array.prototype.flat', 69),
  methodRule('Array.prototype.flatMap', 69),
  ...(
    [
      ['Array.prototype.findLast', 97],
      ['Array.prototype.findLastIndex', 97],
      ['Array.prototype.toReversed', 110],
      ['Array.prototype.toSorted', 110],
      ['Array.prototype.toSpliced', 110],
    ] as const
  ).map(([method, since]) => ({
    ...methodRule(method, since),
    isAllowed: isVueArrayWrapper,
  })),
]

export function findLegacyApis(code: string): LegacyApiViolation[] {
  const violations: LegacyApiViolation[] = []

  for (const rule of RULES) {
    for (const match of code.matchAll(rule.pattern)) {
      if (rule.isAllowed?.(code, match.index))
        continue

      violations.push({
        api: rule.api,
        since: rule.since,
        index: match.index,
        snippet: code.slice(
          Math.max(0, match.index - SNIPPET_RADIUS),
          match.index + match[0].length + SNIPPET_RADIUS,
        ),
      })
    }
  }

  return violations.sort((a, b) => a.index - b.index)
}

export function formatLegacyApiReport(
  violationsByFile: Map<string, LegacyApiViolation[]>,
) {
  const lines = [
    `Бандл витрины использует API новее Chromium ${MIN_CHROMIUM} (webOS 5):`,
  ]

  for (const [fileName, violations] of violationsByFile) {
    const byApi = Map.groupBy(violations, violation => violation.api)

    for (const [api, group] of byApi) {
      lines.push(
        `  - ${api}: есть с Chromium ${group[0]!.since}, ${fileName}, совпадений: ${group.length}`,
        `      …${group[0]!.snippet.replace(/\s+/g, ' ')}…`,
      )
    }
  }

  lines.push(
    'Полифиллов в сборке нет. Замените вызов или зависимость, которая его приносит;',
    'ложное срабатывание исправьте в правилах apps/tv/build/legacyApiGuard.ts.',
  )

  return lines.join('\n')
}

export function legacyApiGuard(): Plugin {
  return {
    name: 'torsher:legacy-api-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const violationsByFile = new Map<string, LegacyApiViolation[]>()

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk')
          continue

        const violations = findLegacyApis(output.code)
        if (violations.length > 0)
          violationsByFile.set(output.fileName, violations)
      }

      if (violationsByFile.size > 0)
        this.error(formatLegacyApiReport(violationsByFile))
    },
  }
}
