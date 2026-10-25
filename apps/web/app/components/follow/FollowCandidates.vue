<script setup lang="ts">
import type { FollowCandidate } from '@torsher/api-client'
import { getErrorMessage } from '@torsher/api-client'
import { BanIcon, RefreshCwIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'

const props = defineProps<{
  followId: string
  season: number
  episode: number
}>()

const { t } = useI18n()
const store = useFollows()
const text = useFollowText()

const items = shallowRef<FollowCandidate[]>([])
const state = ref<'loading' | 'error' | 'ready'>('loading')
const blocking = ref<string | null>(null)
const loading = useHeldLoading(() => state.value === 'loading')

const VERDICT_BADGE = {
  grab: 'success',
  pending: 'info',
  rejected: 'outline',
} as const

async function load() {
  state.value = 'loading'

  try {
    const res = await store.candidates(
      props.followId,
      props.season,
      props.episode,
    )

    items.value = res.items
    state.value = 'ready'
  }
  catch {
    state.value = 'error'
  }
}

function meta(item: FollowCandidate) {
  return [
    item.quality,
    item.studio
    ?? (item.voiceType ? t(`sources.voiceTypes.${item.voiceType}`) : undefined),
    item.size ? text.bytes(item.size) : undefined,
    t('panel.follow.candidates.seeders', { n: item.seeders }, item.seeders),
    item.indexers.join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
}

function reasons(item: FollowCandidate) {
  return item.rejections.map(text.rejection).join('; ')
}

async function onBlock(item: FollowCandidate) {
  if (!item.infoHash)
    return

  blocking.value = item.id

  try {
    await store.block(props.followId, item.infoHash)
    toast.success(t('panel.follow.candidates.blocked'), {
      description: item.title,
    })
    await load()
  }
  catch (err) {
    toast.error(t('panel.follow.candidates.blockFailed'), {
      description: await getErrorMessage(err),
    })
  }
  finally {
    blocking.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="border-t bg-muted/30 px-3 py-2.5">
    <div v-if="loading" class="grid gap-3" aria-busy="true">
      <div v-for="row in 2" :key="row" class="grid gap-1.5">
        <Skeleton class="h-3.5 w-4/5" />
        <Skeleton class="h-3 w-3/5" />
        <Skeleton class="h-4 w-24" />
      </div>
    </div>

    <div
      v-else-if="state === 'error'"
      class="flex items-center justify-between gap-3 text-[13px]"
      role="alert"
    >
      <span class="text-muted-foreground">{{
        t("panel.follow.candidates.loadError")
      }}</span>
      <Button variant="outline" size="xs" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </div>

    <p v-else-if="items.length === 0" class="text-[13px] text-muted-foreground">
      {{ t("panel.follow.candidates.empty") }}
    </p>

    <ul v-else class="grid gap-3">
      <li v-for="item in items" :key="item.id" class="grid gap-1 text-[13px]">
        <span class="font-mono text-xs break-all" :title="item.title">
          {{ item.title }}
        </span>
        <span class="text-[12.5px] text-muted-foreground tabular-nums">
          {{ meta(item) }}
        </span>
        <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Badge :variant="VERDICT_BADGE[item.verdict]">
            {{ t(`panel.follow.candidates.verdicts.${item.verdict}`) }}
          </Badge>
          <span
            v-if="item.rejections.length"
            class="min-w-0 text-[12.5px] text-muted-foreground"
          >{{ reasons(item) }}</span>
        </span>
        <span
          v-if="item.verdict !== 'grab' && item.infoHash"
          class="flex items-center"
        >
          <span
            v-if="item.blocked"
            class="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
          >
            <BanIcon class="size-3.5 -translate-y-px" aria-hidden="true" />
            {{ t("panel.follow.candidates.inBlocklist") }}
          </span>
          <LoadingButton
            v-else
            variant="link"
            size="sm"
            class="h-auto p-0 text-[12.5px]"
            :loading="blocking === item.id"
            :disabled="!!blocking"
            @click="onBlock(item)"
          >
            {{ t("panel.follow.candidates.block") }}
          </LoadingButton>
        </span>
      </li>
    </ul>
  </div>
</template>
