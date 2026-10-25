<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@/components/ui/skeleton'
import AboutCard from '~/components/settings/AboutCard.vue'
import BrandMark from '~/components/shell/BrandMark.vue'
import UpdatesCard from '~/components/updates/UpdatesCard.vue'

definePageMeta({
  // Страница открывается и со входа: гостю — без оболочки панели
  middleware: () => {
    if (!useUser().isAuthenticated.value)
      setPageLayout('auth')
  },
})

const { t } = useI18n()
const updates = useUpdates()
const loading = useHeldLoading(
  () => updates.state.value === 'loading' || updates.state.value === 'idle',
)

// Снимок на открытии, как у родительской страницы настроек
const isGuest = !useUser().isAuthenticated.value

// Обновления — только у владельца: без входа страница показывает одну атрибуцию
if (!isGuest)
  void updates.load()
</script>

<template>
  <div v-if="!isGuest" class="grid gap-5">
    <header>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ t("about.title") }}
      </h1>
      <p class="mt-1 text-muted-foreground">
        {{ t("about.description") }}
      </p>
    </header>
    <AboutCard />
    <!-- Скелетон в размер карточки; ошибка загрузки карточку просто не показывает -->
    <Skeleton
      v-if="loading"
      class="h-72 max-w-180 rounded-xl"
      aria-busy="true"
    />
    <UpdatesCard
      v-else-if="updates.status.value"
      class="max-w-180"
      :status="updates.status.value"
    />
  </div>
  <!-- Без входа: атрибуция и версия доступны со страницы входа -->
  <div v-else class="grid w-full max-w-lg gap-6">
    <div
      class="flex items-center justify-center gap-2.5 text-xl font-semibold tracking-tight"
    >
      <BrandMark class="size-6.5" />
      Torsher
    </div>
    <AboutCard />
    <NuxtLink
      to="/auth/login"
      class="justify-self-center text-[12.5px] text-muted-foreground underline underline-offset-3"
    >
      {{ t("panel.auth.backToLogin") }}
    </NuxtLink>
  </div>
</template>
