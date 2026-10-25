<script setup lang="ts">
import type { FollowDetails } from '@torsher/api-client'
import { ChevronRightIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { EPISODE_TONES, formatAirDate } from '~/lib/follow'
import { toneText } from '~/lib/indexerStatus'
import FollowCandidates from './FollowCandidates.vue'

type Episode = FollowDetails['episodes'][number]

const props = defineProps<{
  details: FollowDetails
}>()

const { t, locale } = useI18n()
const text = useFollowText()

// Раскрытая серия: снимок кандидатов грузится по клику
const openKey = ref<string | null>(null)

const keyOf = (item: Episode) => `${item.season}:${item.episode}`

const seasons = computed(() => {
  const bySeason = new Map<number, Episode[]>()

  for (const item of props.details.episodes) {
    const list = bySeason.get(item.season) ?? []

    list.push(item)
    bySeason.set(item.season, list)
  }

  return [...bySeason].map(([season, episodes]) => ({
    season,
    episodes,
    // Сезон целиком в библиотеке свёрнут: смотреть в нём нечего
    complete: episodes.every(item => item.state === 'in_library'),
  }))
})

watch(
  () => props.details.id,
  () => {
    openKey.value = null
  },
)

function stateText(item: Episode) {
  if (item.state === 'waiting' && item.waitUntil) {
    return t('panel.follow.episodeStates.waitingUntil', {
      until: text.until(item.waitUntil),
    })
  }

  if (item.state === 'upcoming' && item.airDate) {
    return t('panel.follow.episodeStates.upcomingOn', {
      date: formatAirDate(item.airDate, locale.value),
    })
  }

  return t(`panel.follow.episodeStates.${item.state}`)
}

function label(item: Episode) {
  return item.season ? `E${item.episode}` : t('panel.follow.movieLabel')
}

function toggle(item: Episode) {
  const key = keyOf(item)

  openKey.value = openKey.value === key ? null : key
}
</script>

<template>
  <p
    v-if="details.episodes.length === 0"
    class="rounded-lg border px-3 py-4 text-center text-[13px] text-muted-foreground"
  >
    {{ t("panel.follow.card.noEpisodes") }}
  </p>
  <div v-else class="grid gap-2">
    <!-- У фильма сезона нет: без заголовка, иначе `details` нарисует свой -->
    <component
      :is="group.season ? 'details' : 'div'"
      v-for="group in seasons"
      :key="group.season"
      class="group/details overflow-hidden rounded-lg border"
      :open="group.season ? !group.complete : undefined"
    >
      <summary
        v-if="group.season"
        class="flex h-9 list-none items-center gap-2 bg-muted/50 px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden"
      >
        <ChevronRightIcon
          class="size-3.5 text-muted-foreground transition-transform group-open/details:rotate-90"
          aria-hidden="true"
        />
        <span class="font-medium">{{
          t("panel.follow.card.season", { n: group.season })
        }}</span>
        <span v-if="group.complete" class="truncate text-muted-foreground">
          {{
            t(
              "panel.follow.card.seasonComplete",
              { n: group.episodes.length },
              group.episodes.length,
            )
          }}
        </span>
      </summary>
      <ul>
        <li
          v-for="item in group.episodes"
          :key="keyOf(item)"
          :class="group.season ? 'border-t' : 'border-t first:border-t-0'"
        >
          <button
            type="button"
            class="grid min-h-9 w-full grid-cols-[44px_minmax(0,1fr)_16px] items-center gap-x-3 px-3 py-1.5 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:hover:bg-transparent dark:hover:bg-muted"
            :disabled="item.candidates === 0"
            :aria-expanded="
              item.candidates ? openKey === keyOf(item) : undefined
            "
            @click="toggle(item)"
          >
            <span class="font-medium tabular-nums">{{ label(item) }}</span>
            <span :class="cn('truncate', toneText[EPISODE_TONES[item.state]])">
              {{ stateText(item) }}
              <span
                v-if="item.candidates"
                class="ml-1 text-muted-foreground tabular-nums"
              >·
                {{
                  t(
                    "panel.follow.card.candidates",
                    { n: item.candidates },
                    item.candidates,
                  )
                }}</span>
            </span>
            <ChevronRightIcon
              v-if="item.candidates"
              class="size-3.5 text-muted-foreground transition-transform"
              :class="{ 'rotate-90': openKey === keyOf(item) }"
              aria-hidden="true"
            />
          </button>
          <FollowCandidates
            v-if="openKey === keyOf(item)"
            :follow-id="details.id"
            :season="item.season"
            :episode="item.episode"
          />
        </li>
      </ul>
    </component>
  </div>
</template>
