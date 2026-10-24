import type { SeedRule } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { DAY_MINUTES } from '~/lib/torrentSettings'

/** Правило раздачи словами: «до рейтинга 2», «3 дня», «не раздавать» */
export function useSeedRuleText() {
  const { t, locale } = useI18n()

  function duration(minutes: number) {
    const days = minutes % DAY_MINUTES === 0
    const value = days ? minutes / DAY_MINUTES : Math.round(minutes / 60)

    return new Intl.NumberFormat(locale.value.replace('_', '-'), {
      style: 'unit',
      unit: days ? 'day' : 'hour',
      unitDisplay: 'long',
    }).format(value)
  }

  function ratio(value: number) {
    return new Intl.NumberFormat(locale.value.replace('_', '-'), {
      maximumFractionDigits: 2,
    }).format(value)
  }

  function summary(rule: SeedRule) {
    return t(`panel.settings.torrent.seedRule.summary.${rule.mode}`, {
      ratio: ratio(rule.ratio ?? 0),
      time: duration(rule.minutes ?? 0),
    })
  }

  return { summary, ratio }
}
