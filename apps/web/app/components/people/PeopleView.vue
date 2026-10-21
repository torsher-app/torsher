<script setup lang="ts">
import type { Device, Profile } from '@torsher/api-client'
import { CircleAlertIcon, PlusIcon, RefreshCwIcon, TvIcon } from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import ListGroup from '~/components/ListGroup.vue'
import PageBar from '~/components/shell/PageBar.vue'
import DeleteProfileDialog from './DeleteProfileDialog.vue'
import DeviceRow from './DeviceRow.vue'
import PairDeviceDialog from './PairDeviceDialog.vue'
import PeopleSkeleton from './PeopleSkeleton.vue'
import ProfileCard from './ProfileCard.vue'
import ProfileDialog from './ProfileDialog.vue'
import ProfilePinDialog from './ProfilePinDialog.vue'
import ProfileRow from './ProfileRow.vue'
import RenameDeviceDialog from './RenameDeviceDialog.vue'
import RevokeDeviceDialog from './RevokeDeviceDialog.vue'

const { t } = useI18n()
const profilesStore = useProfiles()
const devicesStore = useDevices()
const { profiles, defaultId, clearPin } = profilesStore
const { devices } = devicesStore

// Относительное время в строках обновляется само, без перечитывания списка
const now = useNow({ interval: 30_000 })

const isPairOpen = ref(false)
const isCreateOpen = ref(false)
const selectedId = ref<string | null>(null)
const editTarget = ref<Profile | null>(null)
const pinTarget = ref<Profile | null>(null)
const deleteTarget = ref<Profile | null>(null)
const renameTarget = ref<Device | null>(null)
const revokeTarget = ref<Device | null>(null)

const state = computed(() => {
  const states = [profilesStore.state.value, devicesStore.state.value]

  if (states.includes('error'))
    return 'error'

  return states.every(item => item === 'ready') ? 'ready' : 'loading'
})
const canDelete = computed(() => profiles.value.length > 1)
const selected = computed(
  () => profiles.value.find(item => item.id === selectedId.value) ?? null,
)

/** Флаг диалога из цели: закрытие диалога сбрасывает цель */
function dialogOf<T>(target: Ref<T | null>) {
  return computed({
    get: () => !!target.value,
    set: (isOpen: boolean) => {
      if (!isOpen)
        target.value = null
    },
  })
}

const isEditOpen = dialogOf(editTarget)
const isPinOpen = dialogOf(pinTarget)
const isDeleteOpen = dialogOf(deleteTarget)
const isRenameOpen = dialogOf(renameTarget)
const isRevokeOpen = dialogOf(revokeTarget)

async function onRemovePin(profile: Profile) {
  await clearPin(profile.id)
  toast.success(
    t('panel.people.profiles.toasts.pinRemoved', { name: profile.name }),
  )
}

function load() {
  return Promise.all([profilesStore.load(), devicesStore.load()])
}

// Удалённый профиль закрывает свою карточку
watch(selected, (profile) => {
  if (!profile)
    selectedId.value = null
})

onMounted(() => {
  load()
  devicesStore.startPolling()
})
onBeforeUnmount(devicesStore.stopPolling)
</script>

<template>
  <PageBar :title="t('panel.people.title')" :parent="t('panel.nav.server')">
    <template v-if="state === 'ready'" #actions>
      <Button size="sm" @click="isPairOpen = true">
        <TvIcon aria-hidden="true" />
        <span class="sm:hidden">{{ t("panel.people.pairTvShort") }}</span>
        <span class="hidden sm:inline">{{ t("panel.people.pairTv") }}</span>
      </Button>
    </template>
  </PageBar>

  <PeopleSkeleton v-if="state === 'loading'" />

  <div v-else-if="state === 'error'" class="min-h-0 flex-1 overflow-y-auto">
    <section
      class="mx-auto grid max-w-130 justify-items-center gap-3.5 px-4 pt-[12vh] pb-8 text-center"
      role="alert"
    >
      <div
        class="grid size-11 place-items-center rounded-xl border bg-muted text-destructive"
        aria-hidden="true"
      >
        <CircleAlertIcon class="size-5" />
      </div>
      <h2 class="text-base font-semibold">
        {{ t("panel.people.loadError") }}
      </h2>
      <p class="text-muted-foreground">
        {{ t("panel.people.loadErrorText") }}
      </p>
      <Button variant="outline" class="mt-1" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        {{ t("panel.common.retry") }}
      </Button>
    </section>
  </div>

  <div v-else class="min-h-0 flex-1 overflow-y-auto" data-people-list>
    <section :aria-label="t('panel.people.profiles.group')">
      <ListGroup :title="t('panel.people.profiles.group')">
        <template #meta>
          <span class="tabular-nums">{{ profiles.length }}</span>
        </template>
        <template #actions>
          <Button
            variant="ghost"
            size="sm"
            class="h-7"
            @click="isCreateOpen = true"
          >
            <PlusIcon aria-hidden="true" />
            {{ t("panel.people.profiles.add") }}
          </Button>
        </template>
      </ListGroup>
      <ul>
        <ProfileRow
          v-for="profile in profiles"
          :key="profile.id"
          :profile="profile"
          :selected="profile.id === selectedId"
          :is-default="profile.id === defaultId"
          :can-delete="canDelete"
          @open="selectedId = profile.id"
          @edit="editTarget = profile"
          @pin="pinTarget = profile"
          @remove-pin="onRemovePin(profile)"
          @delete="deleteTarget = profile"
        />
      </ul>
    </section>

    <section :aria-label="t('panel.people.devices.group')">
      <ListGroup :title="t('panel.people.devices.group')">
        <template #meta>
          <span class="tabular-nums">{{ devices.length }}</span>
        </template>
      </ListGroup>
      <ul>
        <DeviceRow
          v-for="device in devices"
          :key="device.id"
          :device="device"
          :now="now.getTime()"
          @rename="renameTarget = device"
          @revoke="revokeTarget = device"
        />
        <li
          v-if="devices.length === 0"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-[13px] text-muted-foreground"
        >
          <span class="min-w-0 flex-1 basis-64">{{
            t("panel.people.devices.empty")
          }}</span>
          <Button variant="outline" size="sm" @click="isPairOpen = true">
            <TvIcon aria-hidden="true" />
            {{ t("panel.people.pairTv") }}
          </Button>
        </li>
      </ul>
    </section>
  </div>

  <ProfileCard
    :profile="selected"
    :is-default="selected?.id === defaultId"
    :can-delete="canDelete"
    :devices="devices"
    @close="selectedId = null"
    @edit="editTarget = selected"
    @pin="pinTarget = selected"
    @remove-pin="selected && onRemovePin(selected)"
    @delete="deleteTarget = selected"
  />
  <PairDeviceDialog v-model:open="isPairOpen" />
  <ProfileDialog v-model:open="isCreateOpen" />
  <ProfileDialog v-model:open="isEditOpen" :profile="editTarget" />
  <ProfilePinDialog v-model:open="isPinOpen" :profile="pinTarget" />
  <DeleteProfileDialog v-model:open="isDeleteOpen" :profile="deleteTarget" />
  <RenameDeviceDialog v-model:open="isRenameOpen" :device="renameTarget" />
  <RevokeDeviceDialog v-model:open="isRevokeOpen" :device="revokeTarget" />
</template>
