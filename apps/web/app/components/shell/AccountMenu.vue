<script setup lang="ts">
import {
  ChevronsUpDownIcon,
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@lucide/vue'
import { language as languageNames } from '@torsher/i18n'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'

defineProps<{
  itemClass: string
}>()

const { t } = useI18n()
const { user: current } = useUser()
// После выхода панель видна, пока открывается вход: имя не пропадает раньше
const user = useLastValue(() => current.value)
const { logout } = useAuth()
const colorMode = useColorMode()
const { language } = usePanelLanguage()

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

// Названия языков — на самих языках: свой язык узнают и в чужом интерфейсе
const LANGUAGES = Object.entries(languageNames).map(([value, label]) => ({
  value,
  label,
}))

const languageLabel = computed(() =>
  language.value === 'browser'
    ? t('panel.account.languageBrowser')
    : languageNames[language.value],
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
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <LanguagesIcon aria-hidden="true" />
          <!-- flex-1 у подписи прижимает текущий язык к стрелке подменю -->
          <span class="flex-1">{{ t("panel.account.language") }}</span>
          <span class="truncate text-muted-foreground">{{
            languageLabel
          }}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="min-w-44">
          <DropdownMenuRadioGroup v-model="language">
            <DropdownMenuRadioItem
              v-for="item in LANGUAGES"
              :key="item.value"
              :value="item.value"
              :lang="item.value.split('_')[0]"
            >
              {{ item.label }}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="browser">
              {{ t("panel.account.languageBrowser") }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
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
