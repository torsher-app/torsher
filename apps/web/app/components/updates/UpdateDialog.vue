<script setup lang="ts">
import { ExternalLinkIcon, MonitorPlayIcon } from '@lucide/vue'
import { useDocumentVisibility } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import CommandLine from '~/components/CommandLine.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { api } from '~/services/api'

const props = defineProps<{
  version: string
  channel: 'stable' | 'beta'
  releaseUrl: string
  docsUrl?: string
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const visibility = useDocumentVisibility()

const COMMAND = 'docker compose pull && docker compose up -d'
// Смотрят ли сейчас: опрос, пока диалог открыт, — просмотр мог закончиться
const WATCHING_POLL_MS = 10_000

const watching = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined
// Запрос в полёте сам продолжит опрос: второй не запускаем, иначе две цепочки
let loading = false
let unmounted = false

async function loadWatching() {
  if (loading)
    return

  loading = true

  try {
    const overview = await withErrorMode('silent', () =>
      api.overview.getOverview())

    watching.value = overview.devices.watching
  }
  catch {
    // Без ответа предупреждение не показываем: команда важнее
  }
  finally {
    loading = false
  }

  // Ответ мог прийти после закрытия диалога, ухода со страницы или из вкладки
  if (!unmounted && open.value && visibility.value === 'visible') {
    clearTimeout(timer)
    timer = setTimeout(loadWatching, WATCHING_POLL_MS)
  }
}

watch(open, (isOpen) => {
  clearTimeout(timer)

  if (isOpen) {
    watching.value = 0
    void loadWatching()
  }
})

// В скрытой вкладке не опрашиваем; вернулись — сразу свежий ответ
watch(visibility, (state) => {
  clearTimeout(timer)

  if (state === 'visible' && open.value && !unmounted)
    void loadWatching()
})

onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(timer)
})

const tag = computed(() => (props.channel === 'beta' ? 'beta' : 'latest'))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader class="text-left">
        <DialogTitle>
          {{ t("panel.updates.dialog.title", { version }) }}
        </DialogTitle>
        <DialogDescription>
          {{ t("panel.updates.dialog.text") }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-2">
        <p class="text-[13.5px] font-medium">
          {{ t("panel.updates.dialog.compose") }}
        </p>
        <CommandLine :command="COMMAND" />
        <p class="text-[12.5px] text-muted-foreground">
          {{ t("panel.updates.dialog.tag", { tag, version }) }}
        </p>
      </div>

      <p class="text-[12.5px] text-muted-foreground">
        {{ t("panel.updates.dialog.backup") }}
      </p>

      <!-- Предупреждение — под командой: появившись, оно не сдвигает то, что уже читают -->
      <Alert v-if="watching" variant="warning" aria-live="polite">
        <MonitorPlayIcon />
        <AlertTitle class="tabular-nums">
          {{ t("panel.updates.dialog.watching", { n: watching }, watching) }}
        </AlertTitle>
        <AlertDescription>
          {{ t("panel.updates.dialog.watchingText") }}
        </AlertDescription>
      </Alert>

      <DialogFooter class="gap-2 sm:justify-between">
        <Button v-if="docsUrl" variant="outline" as-child>
          <a :href="docsUrl" target="_blank" rel="noopener noreferrer">
            {{ t("panel.updates.dialog.docs") }}
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
        <Button as-child>
          <a :href="releaseUrl" target="_blank" rel="noopener noreferrer">
            {{ t("panel.updates.whatsNew") }}
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
