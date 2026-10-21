<script setup lang="ts">
import {
  ChevronsUpDownIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'

defineProps<{
  itemClass: string
}>()

const { t } = useI18n()
const { user } = useUser()
const { logout } = useAuth()
const colorMode = useColorMode()

const THEMES = [
  { value: 'light', icon: SunIcon },
  { value: 'dark', icon: MoonIcon },
  { value: 'system', icon: MonitorIcon },
] as const

const initials = computed(() =>
  (user.value?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join(''),
)

const theme = computed({
  get: () => colorMode.preference,
  set: (value: string) => {
    colorMode.preference = value
  },
})
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <SidebarMenuButton
        :class="itemClass"
        :aria-label="t('panel.account.menu')"
      >
        <span
          class="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {{ initials }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ user?.name }}</span>
        <ChevronsUpDownIcon class="ml-auto opacity-60" aria-hidden="true" />
      </SidebarMenuButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      side="top"
      class="w-(--reka-dropdown-menu-trigger-width) min-w-56"
    >
      <DropdownMenuLabel class="truncate font-normal">
        {{ user?.email }}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{{ t("panel.account.theme") }}</DropdownMenuLabel>
      <DropdownMenuRadioGroup v-model="theme">
        <DropdownMenuRadioItem
          v-for="item in THEMES"
          :key="item.value"
          :value="item.value"
        >
          <component :is="item.icon" aria-hidden="true" />
          {{ t(`panel.account.themes.${item.value}`) }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem as-child>
        <NuxtLink to="/settings/account">
          <UserIcon aria-hidden="true" />
          {{ t("panel.account.settings") }}
        </NuxtLink>
      </DropdownMenuItem>
      <DropdownMenuItem @select="logout">
        <LogOutIcon aria-hidden="true" />
        {{ t("panel.account.logout") }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
