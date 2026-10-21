<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PageBar from '~/components/shell/PageBar.vue'
import { settingsItems } from '~/lib/navigation'

const { t } = useI18n()
const route = useRoute()
const { isAuthenticated } = useUser()

const current = computed(() =>
  settingsItems.find(item => route.path.startsWith(item.to)),
)
</script>

<template>
  <!-- Без входа открывается только «О программе»: без оболочки и подменю -->
  <NuxtPage v-if="!isAuthenticated" />
  <div v-else class="flex min-h-0 flex-1 flex-col">
    <PageBar
      :title="
        current
          ? t(`panel.settings.nav.${current.label}`)
          : t('panel.nav.settings')
      "
      :parent="current ? t('panel.nav.settings') : undefined"
    />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- Один контейнер на все страницы с контентом: заголовки стоят на одной линии -->
      <div
        class="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10 lg:px-8 lg:py-7"
      >
        <nav
          :aria-label="t('panel.settings.nav.label')"
          class="no-scrollbar flex gap-0.5 overflow-x-auto border-b pb-2 md:sticky md:top-0 md:flex-col md:self-start md:border-b-0 md:pb-0"
        >
          <NuxtLink
            v-for="item in settingsItems"
            :key="item.to"
            :to="item.to"
            class="flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13.5px] whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            active-class="bg-accent font-medium text-foreground"
          >
            {{ t(`panel.settings.nav.${item.label}`) }}
          </NuxtLink>
        </nav>
        <div class="grid min-w-0 content-start gap-5">
          <NuxtPage />
        </div>
      </div>
    </div>
  </div>
</template>
