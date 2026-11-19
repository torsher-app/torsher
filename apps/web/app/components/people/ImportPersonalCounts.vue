<script setup lang="ts">
import type { ImportPreview } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'

defineProps<Pick<ImportPreview, 'history' | 'personal'>>()

const { t } = useI18n()
</script>

<template>
  <div v-if="history || personal" class="grid gap-3 text-[12.5px]">
    <!-- Events, seen marks and portable rows have different units. -->
    <section v-if="history" class="grid gap-1.5">
      <h4 class="font-medium">
        {{ t("mine.preview.sections.diary") }}
      </h4>
      <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
        <dt>{{ t("panel.imports.result.imported") }}</dt>
        <dd class="text-right tabular-nums">
          {{ t("mine.preview.views", history.new) }}
        </dd>
        <dt>{{ t("panel.imports.preview.same") }}</dt>
        <dd class="text-right tabular-nums">
          {{ t("mine.preview.views", history.same) }}
        </dd>
        <template v-if="history.skipped">
          <dt>{{ t("panel.imports.preview.skipped") }}</dt>
          <dd class="text-right tabular-nums">
            {{ history.skipped }}
          </dd>
        </template>
      </dl>
      <template v-if="history.seen.new || history.seen.same">
        <h4 class="mt-1 font-medium">
          {{ t("mine.personal.legacyMarks") }}
        </h4>
        <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
          <dt>{{ t("panel.imports.result.imported") }}</dt>
          <dd class="text-right tabular-nums">
            {{ history.seen.new }}
          </dd>
          <dt>{{ t("panel.imports.preview.same") }}</dt>
          <dd class="text-right tabular-nums">
            {{ history.seen.same }}
          </dd>
        </dl>
      </template>
    </section>
    <section v-if="personal" class="grid gap-1.5">
      <h4 class="font-medium">
        {{ t("panel.imports.preview.personal") }}
      </h4>
      <ul class="grid gap-1 text-muted-foreground tabular-nums">
        <li>
          {{
            t("panel.imports.preview.personalChanged", { n: personal.changed })
          }}
        </li>
        <li>
          {{
            t("panel.imports.preview.personalUnchanged", {
              n: personal.unchanged,
            })
          }}
        </li>
        <li>
          {{
            t("panel.imports.preview.personalSkipped", { n: personal.skipped })
          }}
        </li>
      </ul>
    </section>
  </div>
</template>
