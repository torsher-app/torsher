<script setup lang="ts">
import type { LogEntry } from '@torsher/api-client'
import { CopyIcon, XIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatLogDateTime, logLevelView, logSourceLabels } from '~/lib/logs'
import { keepOpenOnListClick } from '~/lib/sheet'

const props = defineProps<{
  entry: LogEntry | null
}>()

const emit = defineEmits<{
  close: []
  copy: [entry: LogEntry]
}>()

const { t, locale } = useI18n()

// Пока лист уезжает, в нём остаётся последняя запись, а не пустота
const shown = shallowRef<LogEntry | null>(props.entry)

watch(
  () => props.entry,
  (entry) => {
    if (entry)
      shown.value = entry
  },
)

const view = computed(() =>
  shown.value ? logLevelView(shown.value.level) : null,
)
const context = computed(() => Object.entries(shown.value?.context ?? {}))

// Строка списка переключает карточку, пустое место под строками закрывает её
function onInteractOutside(event: Event) {
  keepOpenOnListClick(event, '[data-logs-list]')
}
</script>

<template>
  <Sheet
    :open="!!entry"
    :modal="false"
    @update:open="(isOpen) => !isOpen && emit('close')"
  >
    <SheetContent
      side="right"
      :show-close-button="false"
      class="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[440px] md:data-[side=right]:inset-y-2 md:data-[side=right]:right-2 md:data-[side=right]:h-auto md:rounded-r-xl md:border"
      @interact-outside="onInteractOutside"
    >
      <template v-if="shown && view">
        <header
          class="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
        >
          <Badge :variant="view.badge">
            {{ t(`panel.logs.levels.${shown.level}`) }}
          </Badge>
          <SheetTitle class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {{ t(logSourceLabels[shown.source]) }}
          </SheetTitle>
          <SheetDescription class="sr-only">
            {{ shown.message }}
          </SheetDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.common.close')"
            @click="emit('close')"
          >
            <XIcon />
          </Button>
        </header>

        <div
          class="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4"
        >
          <dl
            class="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 text-[13.5px]"
          >
            <dt class="text-muted-foreground">
              {{ t("panel.logs.card.time") }}
            </dt>
            <dd class="tabular-nums">
              <time :datetime="shown.time">{{
                formatLogDateTime(shown.time, locale)
              }}</time>
            </dd>
            <template v-if="(shown.repeat ?? 1) > 1">
              <dt class="text-muted-foreground">
                {{ t("panel.logs.card.repeat") }}
              </dt>
              <dd>
                {{
                  t("panel.logs.repeat", { n: shown.repeat }, shown.repeat ?? 1)
                }}
              </dd>
            </template>
          </dl>

          <section class="grid gap-2">
            <h3 class="text-xs font-medium text-muted-foreground">
              {{ t("panel.logs.card.message") }}
            </h3>
            <p
              class="font-mono text-[12.5px] leading-5 break-words whitespace-pre-wrap"
            >
              {{ shown.message }}
            </p>
          </section>

          <section v-if="context.length" class="grid gap-2">
            <h3 class="text-xs font-medium text-muted-foreground">
              {{ t("panel.logs.card.context") }}
            </h3>
            <dl
              class="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-[13px]"
            >
              <template v-for="[key, value] in context" :key="key">
                <dt
                  class="truncate font-mono text-xs text-muted-foreground"
                  :title="key"
                >
                  {{ key }}
                </dt>
                <dd class="font-mono text-xs break-all">
                  {{ value }}
                </dd>
              </template>
            </dl>
          </section>

          <section v-if="shown.details" class="grid min-w-0 gap-2">
            <h3 class="text-xs font-medium text-muted-foreground">
              {{ t("panel.logs.card.details") }}
            </h3>
            <!-- Трейс читается построчно: прокрутка своя, страница не распирается -->
            <pre
              class="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-5"
              tabindex="0"
            >{{ shown.details }}</pre>
          </section>
        </div>

        <footer class="flex shrink-0 flex-wrap gap-2 border-t p-3">
          <Button variant="outline" size="sm" @click="emit('copy', shown)">
            <CopyIcon aria-hidden="true" />
            {{ t("panel.logs.card.copy") }}
          </Button>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
