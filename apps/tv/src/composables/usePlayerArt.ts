import type { TitleDetails } from '@torsher/api-client'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'
import { loadSeason } from './useTitleSections.ts'

/**
 * Сцена плеера и экрана подготовки: кадр и логотип тайтла, «Сезон 2 · Серия 1 ·
 * Название» и описание серии. Без тайтла (плеер открыт ссылкой из панели) — пусто.
 */
export function usePlayerArt(
  titleId: string | undefined,
  season: number | undefined,
  episode: number | undefined,
) {
  const { t } = useI18n()
  const language = useCatalogLanguage()
  const { data: art } = useResource<TitleDetails>(
    computed(() => (titleId ? `${titleId}:${language.value}` : undefined)),
    (_, signal) =>
      api.catalog.getCatalogTitle(
        titleId!,
        { language: language.value },
        { signal },
      ),
  )
  const episodeName = ref('')
  const episodeOverview = ref('')

  if (titleId && season && episode) {
    loadSeason(titleId, season, language.value)
      .then((details) => {
        const found = details.episodes.find(item => item.number === episode)

        episodeName.value = found?.title ?? ''
        episodeOverview.value = found?.overview ?? ''
      })
      .catch(() => {
        // Без названия серии — только номер
      })
  }

  const subtitle = computed(() =>
    season && episode
      ? [t('player.episodeOf', { season, episode }), episodeName.value]
          .filter(Boolean)
          .join(' · ')
      : '',
  )

  return { art, episodeName, episodeOverview, subtitle }
}
