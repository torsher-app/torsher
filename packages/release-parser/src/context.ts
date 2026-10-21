import type { ParsedField } from './types.ts'
import type { Group, Token, Tokenized } from './tokenize.ts'

/** Чем занят токен: поле, которое его съело, или `noise` — понятный, но не нужный тег. */
export type Claim = ParsedField | 'noise' | 'group' | 'info'

/**
 * Общее состояние разбора. Правила читают токены, отмечают, какие поняли,
 * и пишут уверенность по своим полям; сборщик потом отдаёт непонятое в `unparsed`.
 */
export class ParseContext {
  readonly raw: string
  readonly tokens: Token[]
  readonly groups: Group[]
  readonly claims = new Map<number, Claim>()
  readonly confidence: Partial<Record<ParsedField, number>> = {}

  constructor({ raw, tokens, groups }: Tokenized) {
    this.raw = raw
    this.tokens = tokens
    this.groups = groups
  }

  claim(tokens: Token | Token[], claim: Claim) {
    for (const token of Array.isArray(tokens) ? tokens : [tokens]) {
      if (!this.claims.has(token.index))
        this.claims.set(token.index, claim)
    }
  }

  isClaimed(token: Token) {
    return this.claims.has(token.index)
  }

  setConfidence(field: ParsedField, value: number) {
    this.confidence[field] = Math.max(this.confidence[field] ?? 0, value)
  }

  /** Следующий токен в той же скобочной группе. */
  next(token: Token, offset = 1): Token | undefined {
    const next = this.tokens[token.index + offset]
    return next && next.group === token.group ? next : undefined
  }

  prev(token: Token, offset = 1): Token | undefined {
    const prev = this.tokens[token.index - offset]
    return prev && prev.group === token.group ? prev : undefined
  }

  groupTokens(group: number) {
    return this.tokens.filter(token => token.group === group)
  }

  /** Токены группы вместе с токенами вложенных в неё групп. */
  groupTokensDeep(group: number) {
    const ids = new Set([group])
    for (const item of this.groups) {
      if (item.parent !== undefined && ids.has(item.parent))
        ids.add(item.id)
    }
    return this.tokens.filter(
      token => token.group !== undefined && ids.has(token.group),
    )
  }

  /** Группа начинается сразу за токеном, без слов между ними. */
  groupRightAfter(token: Token): Group | undefined {
    const next = this.tokens[token.index + 1]
    if (next?.group === undefined || next.group === token.group)
      return undefined
    const group = this.groups[next.group]!
    const between = this.raw.slice(token.end, group.start)
    return /^\s*$/.test(between) ? group : undefined
  }
}
