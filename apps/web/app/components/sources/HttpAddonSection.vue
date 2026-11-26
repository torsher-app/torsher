<script setup lang="ts">
import type { HttpAddon } from '@torsher/api-client'
import { PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import ListGroup from '~/components/ListGroup.vue'
import LoadingButton from '~/components/LoadingButton.vue'
import { dialogSheetClass } from '~/lib/dialog'
import { api } from '~/services/api'
import HttpAddonDialog from './HttpAddonDialog.vue'

const emit = defineEmits<{ configured: [value: boolean] }>()
const { t } = useI18n()
const items = shallowRef<HttpAddon[]>([])
const edit = ref(false)
const editingId = ref<string>()
const editing = computed(
  () => items.value.find(addon => addon.id === editingId.value) ?? null,
)
const deleteTarget = shallowRef<HttpAddon>()
const deleteOpen = computed({
  get: () => !!deleteTarget.value,
  set: (value) => {
    if (!value)
      deleteTarget.value = undefined
  },
})
const busy = ref<string>()
const failure = ref(false)
const loading = ref(false)

function replace(itemsNext: HttpAddon[]) {
  items.value = itemsNext
  emit('configured', itemsNext.length > 0)
}

async function load() {
  loading.value = true
  failure.value = false
  try {
    const result = await withErrorMode('silent', () =>
      api.sources.getHttpAddons())
    replace(result.items)
  }
  catch {
    failure.value = true
  }
  finally {
    loading.value = false
  }
}

function saved(addon: HttpAddon) {
  const prior = items.value.find(item => item.id === addon.id)
  replace(
    prior
      ? items.value.map(item => (item.id === addon.id ? addon : item))
      : [...items.value, addon],
  )
}

function open(addon?: HttpAddon) {
  editingId.value = addon?.id
  edit.value = true
}

async function toggle(addon: HttpAddon, enabled: boolean) {
  if (busy.value || loading.value)
    return
  failure.value = false
  if (
    enabled
    && (addon.checkError === 'needs_confirmation'
      || addon.checkError === 'address_changed')
  ) {
    open(addon)
    return
  }
  busy.value = addon.id
  try {
    saved(
      await withErrorMode('silent', () =>
        api.sources.patchHttpAddon(addon.id, { enabled })),
    )
  }
  catch {
    failure.value = true
  }
  finally {
    busy.value = undefined
  }
}

async function remove() {
  const addon = deleteTarget.value
  if (!addon || busy.value || loading.value)
    return
  busy.value = addon.id
  failure.value = false
  try {
    await withErrorMode('silent', () => api.sources.deleteHttpAddon(addon.id))
    replace(items.value.filter(item => item.id !== addon.id))
    deleteTarget.value = undefined
  }
  catch {
    failure.value = true
  }
  finally {
    busy.value = undefined
  }
}

onMounted(load)
</script>

<template>
  <section :aria-label="t('addons.title')" :aria-busy="loading">
    <ListGroup :title="t('addons.title')">
      <template #actions>
        <Button
          variant="ghost"
          size="sm"
          :disabled="loading || !!busy"
          @click="open()"
        >
          <PlusIcon aria-hidden="true" />
          {{ t("addons.add") }}
        </Button>
      </template>
    </ListGroup>

    <div
      v-if="failure"
      class="flex items-center justify-between gap-2 border-b px-4 py-2"
      role="alert"
    >
      <p class="text-sm text-destructive">
        {{ t("panel.sources.errors.unknown") }}
      </p>
      <Button
        variant="outline"
        size="sm"
        :disabled="loading || !!busy"
        @click="load"
      >
        {{ t("panel.common.retry") }}
      </Button>
    </div>

    <ul v-if="items.length">
      <li
        v-for="addon in items"
        :key="addon.id"
        class="flex items-center justify-between gap-2 border-b px-4 py-2"
      >
        <div class="min-w-0">
          <Label :for="`http-addon-enable-${addon.id}`" class="block truncate">
            {{ addon.capabilities.name || addon.origin }}
          </Label>
          <p class="truncate text-xs text-muted-foreground">
            {{ addon.origin }}
          </p>
          <p v-if="addon.checkError" class="text-xs text-destructive">
            {{
              t(
                addon.checkError === "address_changed"
                  || addon.checkError === "needs_confirmation"
                  ? "addons.addressChanged"
                  : "panel.sources.errorTitles.unreachable",
              )
            }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Switch
            :id="`http-addon-enable-${addon.id}`"
            class="mr-1.5"
            :model-value="addon.enabled"
            :disabled="loading || !!busy"
            @update:model-value="toggle(addon, $event)"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.sources.indexers.edit')"
            :disabled="loading || !!busy"
            @click="open(addon)"
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.common.delete')"
            :disabled="loading || !!busy"
            @click="deleteTarget = addon"
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      </li>
    </ul>

    <HttpAddonDialog v-model:open="edit" :addon="editing" @saved="saved" />
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent :class="dialogSheetClass">
        <AlertDialogHeader class="place-items-start text-left">
          <AlertDialogTitle>
            {{
              t("panel.settings.sources.deleteTitle", {
                name: deleteTarget?.capabilities.name || deleteTarget?.origin,
              })
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ deleteTarget?.origin }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="failure" class="text-sm text-destructive" role="alert">
          {{ t("panel.sources.errors.unknown") }}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="!!busy">
            {{ t("panel.common.cancel") }}
          </AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            :loading="!!busy"
            @click="remove"
          >
            {{ t("panel.common.delete") }}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
