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
 * Запрос, сорвавшийся вместе с сервером, повторяет `reload`: плеер зовёт его,
 * когда поток снова пошёл, иначе сцена так и осталась бы без кадра и названия.
 */
export function usePlayerArt(
  titleId: string | undefined,
  season: number | undefined,
  episode: number | undefined,
) {
  const { t } = useI18n()
  const language = useCatalogLanguage()
  const {
    data: art,
    status,
    retry,
  } = useResource<TitleDetails>(
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
  let episodeFailed = false

  function loadEpisode() {
    if (!titleId || !season || !episode)
      return

    episodeFailed = false
    loadSeason(titleId, season, language.value)
      .then((details) => {
        const found = details.episodes.find(item => item.number === episode)

        episodeName.value = found?.title ?? ''
        episodeOverview.value = found?.overview ?? ''
      })
      .catch(() => {
        // Без названия серии — только номер, до следующего `reload`
        episodeFailed = true
      })
  }

  loadEpisode()

  // Только сорвавшееся: загруженное и идущий запрос не трогаем
  function reload() {
    if (status.value === 'error')
      void retry()

    if (episodeFailed)
      loadEpisode()
  }

  const subtitle = computed(() =>
    season && episode
      ? [t('player.episodeOf', { season, episode }), episodeName.value]
          .filter(Boolean)
          .join(' · ')
      : '',
  )

  return { art, episodeName, episodeOverview, subtitle, reload }
}
