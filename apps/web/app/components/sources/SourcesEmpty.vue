<script setup lang="ts">
import { LayersIcon, PlusIcon, RadarIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'

const emit = defineEmits<{
  import: []
  add: []
}>()

const { t } = useI18n()

const choiceClass
  = 'relative grid content-start gap-1.5 rounded-xl border border-input bg-background p-4 text-left outline-none transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50'
</script>

<template>
  <section
    class="mx-auto grid max-w-170 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
  >
    <div
      class="grid size-11 place-items-center rounded-xl border bg-muted"
      aria-hidden="true"
    >
      <RadarIcon class="size-5" />
    </div>
    <h2 class="text-base font-semibold">
      {{ t("panel.sources.empty.title") }}
    </h2>
    <p class="max-w-[52ch] text-pretty text-muted-foreground">
      {{ t("panel.sources.empty.text") }}
    </p>

    <div class="mt-2 grid w-full max-w-160 gap-2.5 sm:grid-cols-2">
      <button type="button" :class="choiceClass" @click="emit('import')">
        <Badge variant="brand" class="absolute top-3.5 right-3.5">
          {{ t("panel.sources.empty.faster") }}
        </Badge>
        <LayersIcon class="size-4" aria-hidden="true" />
        <span class="font-semibold">{{ t("panel.sources.import") }}</span>
        <span class="text-[13px] text-muted-foreground">
          {{ t("panel.sources.empty.importText") }}
        </span>
      </button>
      <button type="button" :class="choiceClass" @click="emit('add')">
        <PlusIcon class="size-4" aria-hidden="true" />
        <span class="font-semibold">{{
          t("panel.sources.empty.manualTitle")
        }}</span>
        <span class="text-[13px] text-muted-foreground">
          {{ t("panel.sources.empty.manualText") }}
        </span>
      </button>
    </div>

    <p class="mt-1.5 max-w-[56ch] text-[12.5px] text-muted-foreground">
      {{ t("panel.sources.empty.foot") }}
    </p>
  </section>
</template>
