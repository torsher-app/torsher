<script setup lang="ts">
import { CopyIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { copyText } from '~/lib/clipboard'

const props = defineProps<{
  command: string
}>()

const { t } = useI18n()

async function copy() {
  try {
    await copyText(props.command)
    toast.success(t('panel.auth.commandCopied'))
  }
  catch {
    toast.error(t('panel.auth.copyFailed'))
  }
}
</script>

<template>
  <!-- Команда на сервере одной строкой с «Скопировать»: длинная переносится, а не прокручивается -->
  <div
    class="flex items-center gap-1 rounded-md border bg-background py-1 pr-1 pl-2.5 text-foreground"
  >
    <code class="min-w-0 flex-1 font-mono text-[12.5px] break-all">{{
      command
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
</template>
