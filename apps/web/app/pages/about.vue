<script setup lang="ts">
import type { AboutResponse } from '@torsher/api-client'
import tmdbLogo from '@torsher/tokens/assets/tmdb.svg'
import { useI18n } from 'vue-i18n'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  <div class="flex min-h-screen items-center justify-center p-4">
    <Card class="w-full max-w-lg">
      <CardHeader>
        <CardTitle class="text-2xl">
          Torsher
        </CardTitle>
        <CardDescription v-if="about">
          {{ t("about.license", { license: about.license }) }}
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-6">
        <p v-if="failed" class="text-sm text-muted-foreground">
          {{ t("about.serverUnavailable") }}
        </p>
        <dl
          v-else
          class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm"
          :aria-busy="!about"
        >
          <dt class="text-muted-foreground">
            {{ t("about.version") }}
          </dt>
          <dd>{{ about?.version }}</dd>
          <dt class="text-muted-foreground">
            {{ t("about.commit") }}
          </dt>
          <dd class="font-mono">
            {{ about && (about.commit ?? t("about.unknown")) }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t("about.source") }}
          </dt>
          <dd class="min-w-0 truncate">
            <a
              v-if="about"
              :href="about.sourceUrl"
              class="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ about.sourceUrl }}
            </a>
          </dd>
        </dl>

        <!-- Атрибуция TMDB: логотип скромнее названия приложения, цвет и пропорции файла не меняем -->
        <section class="grid gap-2 border-t pt-4 text-sm">
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
      </CardContent>
    </Card>
  </div>
</template>
