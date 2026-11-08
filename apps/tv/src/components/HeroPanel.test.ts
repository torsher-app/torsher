import type { Card, ContinueCard } from '@torsher/api-client'
import { messages, pluralRules } from '@torsher/i18n'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import HeroPanel from './HeroPanel.vue'

const card: ContinueCard = {
  id: 'tmdb:movie:900001',
  kind: 'movie',
  title: 'Home test',
  originalTitle: 'Home test',
  season: null,
  episode: null,
  position: 1200,
  duration: 2400,
  next: false,
  file: null,
}
async function render(
  item: Card | ContinueCard,
  compact = true,
  resume = true,
) {
  const app = createSSRApp({
    render: () =>
      h(HeroPanel, {
        compact,
        resume,
        hero: {
          card: item,
          details: {
            overview: 'Ordinary plot',
            ratings: [],
            genres: [],
            kind: item.kind,
          } as never,
        },
      }),
  })
  app.use(
    createI18n({ legacy: false, locale: 'en_US', messages, pluralRules }),
  )
  return renderToString(app)
}

describe('home hero continuation context', () => {
  it('shows remaining movie time instead of its plot', async () => {
    const html = await render(card)
    expect(html).toContain('20 min')
    expect(html).not.toContain('Ordinary plot')
  })
  it('shows the current episode and its title with remaining time', async () => {
    const html = await render({
      ...card,
      kind: 'series',
      season: 2,
      episode: 5,
      episodeTitle: 'The Return',
    })
    expect(html).toContain('S2E5')
    expect(html).toContain('20 min')
    expect(html).toContain('The Return')
    expect(html).not.toContain('Ordinary plot')
  })
  it.each([
    [{ next: true }, 'Next episode'],
    [{ next: true, followNewEpisode: true }, 'New episode'],
    [{ position: 0, next: false, followNewEpisode: true }, 'New episode'],
    [{ position: 1200, next: false, followNewEpisode: true }, '20 min'],
  ])('uses the existing action label for %j', async (context, label) => {
    const html = await render({
      ...card,
      kind: 'series',
      season: 1,
      episode: 3,
      ...context,
    })
    expect(html).toContain('S1E3')
    expect(html.toLowerCase()).toContain(label.toLowerCase())
  })
  it('does not invent remaining time for unknown duration', async () => {
    const html = await render({ ...card, duration: null })
    expect(html).not.toContain('min')
    expect(html).not.toContain('Ordinary plot')
    const episode = await render({
      ...card,
      kind: 'series',
      season: 1,
      episode: 4,
      duration: null,
      episodeTitle: 'Unknown length',
    })
    expect(episode).toContain('S1E4')
    expect(episode).toContain('Unknown length')
    expect(episode).not.toContain('min')
  })
  it('keeps ordinary hero descriptions and other modes unchanged', async () => {
    expect(await render(card, false)).toContain('Ordinary plot')
    expect(await render(card, true, false)).toContain('Ordinary plot')
    expect(
      await render({
        id: card.id,
        title: card.title,
        originalTitle: card.title,
        kind: 'movie',
      }),
    ).toContain('Ordinary plot')
  })
})
