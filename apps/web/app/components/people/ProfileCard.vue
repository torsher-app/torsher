<script setup lang="ts">
import type { Device, Profile } from '@torsher/api-client'
import { InfoIcon, KeyRoundIcon, PencilIcon, XIcon } from '@lucide/vue'
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
import ProfileAvatar from './ProfileAvatar.vue'

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
