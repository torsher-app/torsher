<script setup lang="ts">
import { ImageIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

const { t } = useI18n()
const { settings, failed, busy, load, toggle, regenerate }
  = useThumbnailSettings()
</script>

<template>
  <Card class="gap-4 p-5">
    <CardTitle
      class="flex items-center gap-2 text-base font-semibold tracking-tight"
    >
      <ImageIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      {{ t("panel.settings.storage.thumbnails.title") }}
    </CardTitle>
    <p class="text-sm text-muted-foreground">
      {{ t("panel.settings.storage.thumbnails.description") }}
    </p>
    <div v-if="failed" class="flex flex-wrap items-center gap-3" role="alert">
      <p>{{ t("panel.settings.storage.loadError") }}</p>
      <Button variant="outline" size="sm" @click="load">
        {{ t("panel.common.retry") }}
      </Button>
    </div>
    <template v-if="settings">
      <div class="flex items-center justify-between gap-4">
        <Label for="library-thumbnails">{{
          t("panel.settings.storage.thumbnails.automatic")
        }}</Label>
        <Switch
          id="library-thumbnails"
          :model-value="settings.automatic"
          :disabled="busy"
          @update:model-value="toggle"
        />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          :disabled="busy || settings.running"
          @click="regenerate"
        >
          {{ t("panel.settings.storage.thumbnails.regenerate") }}
        </Button>
        <p
          v-if="settings.running || settings.total"
          class="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {{
            settings.running
              ? t("panel.settings.storage.thumbnails.progress", {
                completed: settings.completed,
                total: settings.total,
              })
              : t("panel.settings.storage.thumbnails.done", {
                generated: settings.generated,
                total: settings.total,
              })
          }}
        </p>
      </div>
    </template>
    <Skeleton v-else-if="!failed" class="h-20" />
  </Card>
</template>
