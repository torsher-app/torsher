<script setup lang="ts">
import { SettingsIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

// Имени сервера пока нет: подписью служит адрес, по которому открыта панель
const host = useRequestURL().host

// Выбранный пункт на фоне контента — иначе на фоне сайдбара его не видно
const itemClass
  = 'h-7.5 gap-2.5 px-2 text-[13.5px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.04)] [&_svg]:text-current'

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

// Счётчик проблем виден до перехода в раздел
onMounted(ensureLoaded)
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

    <SidebarContent class="px-2 pt-2 md:px-0">
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
              v-if="item.label === 'sources' && attentionCount > 0"
              class="top-1.25 right-1.5 h-4.5 min-w-4.5 rounded-full bg-destructive px-1.25 text-[11px] font-semibold text-white"
            >
              <span aria-hidden="true">{{ attentionCount }}</span>
              <span class="sr-only">{{
                t("panel.nav.attention", attentionCount)
              }}</span>
            </SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </nav>
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
