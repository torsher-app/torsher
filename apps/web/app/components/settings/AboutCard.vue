<script setup lang="ts">
import type { AboutResponse } from '@torsher/api-client'
import tmdbLogo from '@torsher/tokens/assets/tmdb.svg'
import { useI18n } from 'vue-i18n'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import BrandMark from '~/components/shell/BrandMark.vue'
import { api } from '~/services/api'

const { t } = useI18n()

const about = shallowRef<AboutResponse>()
const failed = ref(false)

// Без авторизации и без тоста: атрибуция на странице видна и при ошибке
onMounted(async () => {
  try {
    about.value = await withErrorMode('silent', () => api.about.getAbout())
  }
  catch {
    failed.value = true
  }
})
</script>

<template>
  <Card class="max-w-180 gap-5 p-5.5">
    <div class="flex items-center gap-3">
      <span
        class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <BrandMark class="size-6" />
      </span>
      <div class="min-w-0">
        <div class="text-[17px] font-semibold">
          Torsher
        </div>
        <div class="text-[13px] text-muted-foreground">
          {{ t("about.tagline") }}
        </div>
      </div>
    </div>

    <p v-if="failed" class="text-muted-foreground">
      {{ t("about.serverUnavailable") }}
    </p>
    <dl
      v-else
      class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2.5"
      :aria-busy="!about"
    >
      <dt class="text-muted-foreground">
        {{ t("about.version") }}
      </dt>
      <dd class="tabular-nums">
        <Skeleton v-if="!about" class="h-4 w-12" />
        <template v-else>
          {{ about.version }}
        </template>
      </dd>
      <dt class="text-muted-foreground">
        {{ t("about.commit") }}
      </dt>
      <dd :class="{ 'font-mono text-xs leading-5': about?.commit }">
        <Skeleton v-if="!about" class="h-4 w-16" />
        <template v-else>
          {{ about.commit ?? t("about.unknown") }}
        </template>
      </dd>
      <dt class="text-muted-foreground">
        {{ t("about.licenseLabel") }}
      </dt>
      <dd>
        <Skeleton v-if="!about" class="h-4 w-20" />
        <template v-else>
          {{ about.license }}
        </template>
      </dd>
      <dt class="text-muted-foreground">
        {{ t("about.source") }}
      </dt>
      <dd class="min-w-0 break-words">
        <Skeleton v-if="!about" class="h-4 w-48" />
        <a
          v-else
          :href="about.sourceUrl"
          class="underline underline-offset-3"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ about.sourceUrl.replace(/^https?:\/\//, "") }}
        </a>
      </dd>
    </dl>

    <p v-if="about" class="text-[13px] text-muted-foreground">
      {{ t("about.license", { license: about.license }) }}
    </p>

    <!-- Атрибуция TMDB: логотип скромнее названия приложения, цвет и пропорции файла не меняем -->
    <section class="grid gap-2 border-t pt-4.5 text-[13.5px]">
      <img
        :src="tmdbLogo"
        :alt="t('about.tmdbLogo')"
        class="h-4 w-auto self-start"
      >
      <p>{{ t("about.dataSource") }}</p>
      <p class="text-muted-foreground">
        {{ t("about.tmdbNotice") }}
      </p>
    </section>
  </Card>
</template>
