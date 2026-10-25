<script setup lang="ts">
import { SettingsIcon, TvIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { navItems } from '~/lib/navigation'
import AccountMenu from './AccountMenu.vue'
import BrandMark from './BrandMark.vue'

const { t } = useI18n()
const route = useRoute()
const { setOpenMobile } = useSidebar()
const { attentionCount, ensureLoaded } = useSources()
const downloads = useTorrents()
const followed = useFollows()

// Витрина открывается с профилем по умолчанию: вход у неё общий с панелью
const { tvUrl } = useRuntimeConfig().public

// Имени сервера пока нет: подписью служит адрес, по которому открыта панель
const host = useRequestURL().host

// Выбранный пункт на фоне контента — иначе на фоне сайдбара его не видно
const itemClass
  = 'h-7.5 gap-2.5 px-2 text-[13.5px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.04)] [&_svg]:text-current'

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

function attentionOf(label: string) {
  if (label === 'sources')
    return attentionCount.value

  if (label === 'follow')
    return followed.attentionCount.value

  return label === 'torrents' ? downloads.attentionCount.value : 0
}

// Счётчик проблем и точка загрузок видны до перехода в раздел
onMounted(() => {
  void ensureLoaded()
  void downloads.ensureLoaded()
  void followed.ensureLoaded()
})
watch(
  () => route.fullPath,
  () => setOpenMobile(false),
)
</script>

<template>
  <!-- На телефоне сайдбар — лист без отступов контейнера: отступы у секций -->
  <Sidebar variant="inset">
    <SidebarHeader class="px-2 pt-3 md:px-0 md:pt-1">
      <NuxtLink
        to="/"
        class="flex items-center gap-2.5 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BrandMark class="size-5.5 shrink-0" />
        <span class="grid min-w-0 leading-tight">
          <span class="text-base font-semibold tracking-tight">Torsher</span>
          <span class="truncate text-xs text-muted-foreground">{{ host }}</span>
        </span>
      </NuxtLink>
    </SidebarHeader>

    <!-- Область прокручивается и обрезает выходящее за край: запас 2 px по
         бокам под кольцо фокуса, отрицательный отступ держит пункты на месте -->
    <SidebarContent class="px-2 pt-2 md:-mx-0.5 md:px-0.5">
      <nav :aria-label="t('panel.nav.label')">
        <SidebarMenu class="gap-px">
          <SidebarMenuItem v-for="item in navItems" :key="item.to">
            <SidebarMenuButton
              as-child
              :is-active="isActive(item.to)"
              :class="itemClass"
            >
              <NuxtLink :to="item.to">
                <component :is="item.icon" aria-hidden="true" />
                <span>{{ t(`panel.nav.${item.label}`) }}</span>
              </NuxtLink>
            </SidebarMenuButton>
            <SidebarMenuBadge
              v-if="attentionOf(item.label) > 0"
              class="top-1.25 right-1.5 h-4.5 min-w-4.5 rounded-full bg-destructive px-1.25 text-[11px] font-semibold text-white"
            >
              <span aria-hidden="true">{{ attentionOf(item.label) }}</span>
              <span class="sr-only">{{
                t("panel.nav.attention", attentionOf(item.label))
              }}</span>
            </SidebarMenuBadge>
            <!-- Янтарная точка, пока что-то качается. По центру строки: базовый
                 `top` бейджа рассчитан на счётчик высотой 20 px и перебивает
                 обычный отступ, поэтому — с `!` -->
            <SidebarMenuBadge
              v-else-if="
                item.label === 'torrents' && downloads.isDownloading.value
              "
              class="top-1/2! right-2.5 size-1.75 min-w-0 -translate-y-1/2 rounded-full bg-brand p-0"
            >
              <span class="sr-only">{{ t("panel.nav.downloading") }}</span>
            </SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </nav>

      <SidebarGroup class="mt-3 p-0">
        <SidebarGroupLabel class="h-6.5">
          {{ t("panel.nav.links") }}
        </SidebarGroupLabel>
        <SidebarMenu class="gap-px">
          <SidebarMenuItem>
            <SidebarMenuButton as-child :class="itemClass">
              <a :href="tvUrl" target="_blank" rel="noopener">
                <TvIcon aria-hidden="true" />
                <span>{{ t("panel.nav.showcase") }}</span>
                <span class="sr-only">({{ t("panel.nav.newTab") }})</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter class="px-2 pb-3 md:px-0 md:pb-1">
      <SidebarMenu class="gap-px">
        <SidebarMenuItem>
          <SidebarMenuButton
            as-child
            :is-active="isActive('/settings')"
            :class="itemClass"
          >
            <NuxtLink to="/settings">
              <SettingsIcon aria-hidden="true" />
              <span>{{ t("panel.nav.settings") }}</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <AccountMenu :item-class="itemClass" />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
</template>
