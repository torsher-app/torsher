<script setup lang="ts">
import type { Device, Profile } from '@torsher/api-client'
import {
  ChevronRightIcon,
  InfoIcon,
  KeyRoundIcon,
  PencilIcon,
  RefreshCwIcon,
  XIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import HistoryRow from '~/components/history/HistoryRow.vue'
import ProfileAvatar from './ProfileAvatar.vue'
import ProfileImportSection from './ProfileImportSection.vue'

const props = defineProps<{
  profile: Profile | null
  isDefault: boolean
  canDelete: boolean
  devices: Device[]
}>()

const emit = defineEmits<{
  close: []
  edit: []
  pin: []
  removePin: []
  delete: []
}>()

const { t } = useI18n()
const meta = useProfileMeta()

const shown = useLastValue(() => props.profile)

// Последнее, что смотрел профиль: владельцу видно, чем заняты домашние
const RECENT_LIMIT = 5
const now = useNow({ interval: 30_000 })
const recent = useProfileHistory(() => shown.value?.id, {
  limit: RECENT_LIMIT,
})

const profileDevices = computed(() =>
  props.devices.filter(item => item.profile?.id === shown.value?.id),
)

// Список под карточкой остаётся живым: клик по другой строке переключает карточку
function onInteractOutside(event: Event) {
  const target = event.target as HTMLElement | null

  if (target?.closest('[data-people-list]'))
    event.preventDefault()
}
</script>

<template>
  <Sheet
    :open="!!profile"
    :modal="false"
    @update:open="(isOpen) => !isOpen && emit('close')"
  >
    <SheetContent
      side="right"
      :show-close-button="false"
      class="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[440px] md:data-[side=right]:inset-y-2 md:data-[side=right]:right-2 md:data-[side=right]:h-auto md:rounded-r-xl md:border"
      @interact-outside="onInteractOutside"
    >
      <template v-if="shown">
        <header
          class="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
        >
          <ProfileAvatar :name="shown.name" :color="shown.color" />
          <SheetTitle class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {{ shown.name }}
          </SheetTitle>
          <SheetDescription class="sr-only">
            {{ meta.languageOf(shown) }}
          </SheetDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.common.close')"
            @click="emit('close')"
          >
            <XIcon />
          </Button>
        </header>

        <div
          class="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4"
        >
          <Alert v-if="isDefault" variant="info">
            <InfoIcon />
            <AlertDescription>
              {{ t("panel.people.card.defaultHint") }}
            </AlertDescription>
          </Alert>

          <dl
            class="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13.5px]"
          >
            <dt class="text-muted-foreground">
              {{ t("panel.people.card.color") }}
            </dt>
            <dd class="flex items-center gap-2">
              <ProfileAvatar :name="shown.name" :color="shown.color" />
              {{ t(`panel.people.colors.${shown.color}`) }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.people.card.language") }}
            </dt>
            <dd>{{ meta.languageOf(shown) }}</dd>
            <dt class="text-muted-foreground">
              {{ t("panel.people.card.pin") }}
            </dt>
            <dd class="flex items-baseline gap-2">
              <Badge :variant="shown.hasPin ? 'success' : 'outline'">
                {{
                  t(
                    shown.hasPin
                      ? "panel.people.card.pinOn"
                      : "panel.people.card.pinOff",
                  )
                }}
              </Badge>
              <Button
                v-if="shown.hasPin"
                variant="link"
                size="xs"
                class="h-auto px-0 text-muted-foreground"
                @click="emit('removePin')"
              >
                {{ t("panel.people.profiles.removePin") }}
              </Button>
            </dd>
            <dt class="text-muted-foreground">
              {{ t("panel.people.card.ageLimit") }}
            </dt>
            <dd>{{ meta.ageOf(shown) }}</dd>
            <dt class="self-start text-muted-foreground">
              {{ t("panel.people.card.devices") }}
            </dt>
            <dd>
              {{
                profileDevices.map((item) => item.name).join(", ")
                  || t("panel.people.card.noDevices")
              }}
            </dd>
          </dl>

          <section class="grid gap-2" :aria-label="t('panel.history.recent')">
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="text-[13.5px] font-medium">
                {{ t("panel.history.recent") }}
              </h3>
              <NuxtLink
                v-if="recent.state.value === 'ready' && recent.total.value > 0"
                :to="`/people/${shown.id}/history`"
                class="inline-flex items-center gap-0.5 text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                {{ t("panel.history.all", { n: recent.total.value }) }}
                <ChevronRightIcon class="size-3.5" aria-hidden="true" />
              </NuxtLink>
            </div>
            <ul
              v-if="recent.state.value === 'loading'"
              class="-mx-4 border-t"
              aria-busy="true"
            >
              <li
                v-for="row in 3"
                :key="row"
                class="flex h-14 items-center gap-3 border-b pr-3 pl-4"
              >
                <Skeleton class="h-10 w-7 rounded-sm" />
                <div class="grid flex-1 gap-1.5">
                  <Skeleton class="h-3.5 w-2/5" />
                  <Skeleton class="h-3 w-1/4" />
                </div>
              </li>
            </ul>
            <div
              v-else-if="recent.state.value === 'error'"
              class="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground"
              role="alert"
            >
              {{ t("panel.history.loadError") }}
              <Button variant="outline" size="xs" @click="recent.load">
                <RefreshCwIcon aria-hidden="true" />
                {{ t("panel.common.retry") }}
              </Button>
            </div>
            <p
              v-else-if="recent.items.value.length === 0"
              class="text-[13px] text-muted-foreground"
            >
              {{ t("panel.history.empty") }}
            </p>
            <ul v-else class="-mx-4 border-t">
              <HistoryRow
                v-for="entry in recent.items.value"
                :key="entry.title.id"
                :entry="entry"
                :now="now.getTime()"
              />
            </ul>
          </section>

          <ProfileImportSection :profile="shown" />
        </div>

        <footer class="flex shrink-0 flex-wrap gap-2 border-t p-3">
          <Button variant="outline" size="sm" @click="emit('edit')">
            <PencilIcon aria-hidden="true" />
            {{ t("panel.people.profiles.edit") }}
          </Button>
          <Button variant="ghost" size="sm" @click="emit('pin')">
            <KeyRoundIcon aria-hidden="true" />
            {{
              t(
                shown.hasPin
                  ? "panel.people.profiles.changePin"
                  : "panel.people.profiles.setPin",
              )
            }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="ml-auto"
            :disabled="!canDelete"
            :title="
              canDelete ? undefined : t('panel.people.profiles.lastProfile')
            "
            @click="emit('delete')"
          >
            {{ t("panel.common.delete") }}
          </Button>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
