<script setup lang="ts">
import { CopyIcon, LayersIcon, TerminalIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { copyText } from '~/lib/clipboard'

const emit = defineEmits<{
  import: []
}>()

// Prowlarr описан в примере установки (docker-compose.example.yml) под профилем
const COMMAND = 'docker compose --profile prowlarr up -d'

const { t } = useI18n()

const choiceClass
  = 'grid content-start gap-1.5 rounded-xl border border-input bg-background p-4 text-left'

async function copy() {
  try {
    await copyText(COMMAND)
    toast.success(t('panel.auth.commandCopied'))
  }
  catch {
    toast.error(t('panel.auth.copyFailed'))
  }
}
</script>

<template>
  <!-- Ничего не нашлось: два пути, как в пустом разделе «Источники» -->
  <div class="grid gap-2.5 sm:grid-cols-2">
    <button
      type="button"
      :class="choiceClass"
      class="outline-none transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
      @click="emit('import')"
    >
      <LayersIcon class="size-4" aria-hidden="true" />
      <span class="font-semibold">{{
        t("panel.wizard.sources.none.importTitle")
      }}</span>
      <span class="text-[13px] text-muted-foreground">
        {{ t("panel.wizard.sources.none.importText") }}
      </span>
    </button>
    <div :class="choiceClass">
      <TerminalIcon class="size-4" aria-hidden="true" />
      <span class="font-semibold">{{
        t("panel.wizard.sources.none.composeTitle")
      }}</span>
      <span class="text-[13px] text-muted-foreground">
        {{ t("panel.wizard.sources.none.composeText") }}
      </span>
      <div
        class="mt-1 flex items-center gap-1 rounded-md border bg-muted/50 py-1 pr-1 pl-2.5"
      >
        <code class="min-w-0 flex-1 font-mono text-[12.5px] break-all">{{
          COMMAND
        }}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground"
          :aria-label="t('panel.auth.copyCommand')"
          @click="copy"
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  </div>
</template>
