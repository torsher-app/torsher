<script setup lang="ts">
import type { FollowActivityItem } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import LoadingButton from '~/components/LoadingButton.vue'
import { EVENT_VIEW } from '~/lib/follow'
import { toneText } from '~/lib/indexerStatus'
import { formatLogDateTime } from '~/lib/logs'

const props = defineProps<{
  item: FollowActivityItem
  /** Ответ на «похоже» уходит на сервер */
  answering?: boolean
}>()

const emit = defineEmits<{
  answer: [confirm: boolean]
}>()

const { t, locale } = useI18n()
const text = useFollowText()
const title = useFollowTitle(() => props.item.titleId)

const view = computed(() => EVENT_VIEW[props.item.kind] ?? EVENT_VIEW.search!)
const time = computed(() =>
  new Intl.DateTimeFormat(locale.value.replace('_', '-'), {
    hour: '2-digit',
    minute: '2-digit',
    // В колонке 40 px «09:29 AM» переносится: время — в 24 часа, как в журнале
    hourCycle: 'h23',
  }).format(new Date(props.item.at)),
)
// У пробела ленты индексатор уже назван в тексте, тайтла нет
const second = computed(() =>
  [
    props.item.releaseTitle,
    props.item.kind === 'gap' ? null : props.item.indexer,
  ]
    .filter(Boolean)
    .join(' · '),
)
const name = computed(() => title.value?.title ?? '')
const canAnswer = computed(
  () =>
    props.item.kind === 'unsure'
    && !props.item.params.confirmedAt
    && !props.item.params.dismissedAt,
)
</script>

<template>
  <li
    class="grid grid-cols-[40px_16px_minmax(0,1fr)] items-start gap-x-3 border-b py-2.5 pr-4 pl-4 text-[13.5px]"
  >
    <time
      :datetime="item.at"
      :title="formatLogDateTime(item.at, locale)"
      class="pt-0.5 text-[12.5px] text-muted-foreground tabular-nums"
    >{{ time }}</time>
    <component
      :is="view.icon"
      :class="cn('mt-px size-4', toneText[view.tone])"
      aria-hidden="true"
    />
    <span class="grid min-w-0 gap-0.5">
      <span class="min-w-0">
        <template v-if="item.titleId">
          <span v-if="name" class="font-medium">{{ name }}</span>
          <Skeleton v-else class="inline-block h-3.5 w-28 align-middle" />
          <span class="text-muted-foreground"> · </span>
        </template>
        <span>{{ text.event(item) }}</span>
      </span>
      <span
        v-if="second"
        class="truncate font-mono text-xs text-muted-foreground"
        :title="second"
      >{{ second }}</span>
      <span v-if="canAnswer" class="mt-1 flex flex-wrap gap-2">
        <LoadingButton
          variant="outline"
          size="xs"
          :loading="answering"
          @click="emit('answer', true)"
        >
          {{ t("panel.follow.unsure.confirm") }}
        </LoadingButton>
        <Button
          variant="ghost"
          size="xs"
          :disabled="answering"
          @click="emit('answer', false)"
        >
          {{ t("panel.follow.unsure.dismiss") }}
        </Button>
      </span>
    </span>
  </li>
</template>
