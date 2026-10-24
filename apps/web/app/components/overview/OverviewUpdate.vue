<script setup lang="ts">
import type { OverviewUpdate } from '@torsher/api-client'
import { ArrowUpCircleIcon, ExternalLinkIcon, XIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import UpdateDialog from '~/components/updates/UpdateDialog.vue'
import { formatDate } from '~/lib/format'

const props = defineProps<{
  update: OverviewUpdate
}>()

const emit = defineEmits<{
  dismissed: []
}>()

const { t, locale } = useI18n()
const { dismiss } = useUpdates()

const dialogOpen = ref(false)
const isDismissing = ref(false)

async function onDismiss() {
  isDismissing.value = true

  try {
    await dismiss(props.update.version)
    emit('dismissed')
  }
  catch {
    // Ошибку запроса уже показал тостом клиент API
  }
  finally {
    isDismissing.value = false
  }
}
</script>

<template>
  <section
    class="grid gap-3 rounded-xl border bg-card p-4 sm:p-5"
    aria-labelledby="overview-update"
  >
    <div class="flex items-start gap-3">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <ArrowUpCircleIcon class="size-4.5" />
      </span>
      <div class="grid min-w-0 flex-1 gap-0.5">
        <h2
          id="overview-update"
          class="text-[15px] font-semibold tracking-tight tabular-nums"
        >
          {{ t("panel.updates.available", { version: update.version }) }}
        </h2>
        <p
          v-if="update.publishedAt"
          class="text-[13px] text-muted-foreground tabular-nums"
        >
          {{
            t("panel.updates.published", {
              date: formatDate(update.publishedAt, locale),
            })
          }}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        class="-mt-1 -mr-1 shrink-0 text-muted-foreground"
        :disabled="isDismissing"
        :aria-label="t('panel.updates.dismiss')"
        :title="t('panel.updates.dismiss')"
        @click="onDismiss"
      >
        <XIcon />
      </Button>
    </div>

    <ul
      v-if="update.notes.length"
      class="ml-12 grid list-disc gap-1 pl-4 text-[13.5px] marker:text-muted-foreground"
    >
      <li v-for="(note, index) in update.notes" :key="index">
        {{ note }}
      </li>
    </ul>

    <div class="flex flex-wrap gap-2 pl-12">
      <Button size="sm" @click="dialogOpen = true">
        {{ t("panel.updates.howTo") }}
      </Button>
      <Button size="sm" variant="outline" as-child>
        <a :href="update.url" target="_blank" rel="noopener noreferrer">
          {{ t("panel.updates.whatsNew") }}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      </Button>
    </div>

    <UpdateDialog
      v-model:open="dialogOpen"
      :version="update.version"
      :channel="update.channel"
      :release-url="update.url"
      :docs-url="update.docsUrl"
    />
  </section>
</template>
