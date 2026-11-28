<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import type { ExternalListExclusions } from '~/lib/externalLists'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import {
  externalListsKey as base,
  externalListRequestError,
} from '~/lib/externalLists'
import { api } from '~/services/api'

defineProps<{ profiles: Profile[] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const selectId = useId()
const profileId = ref('')
const page = shallowRef<ExternalListExclusions>()
const loading = ref(false)
const removing = ref<string>()
const problem = ref<string>()
let revision = 0

async function load(offset?: number) {
  if (!profileId.value || !open.value)
    return

  const current = ++revision
  loading.value = true
  problem.value = undefined

  try {
    const result = await withErrorMode('silent', () =>
      api.settings.getExternalListExclusions({
        profileId: profileId.value,
        offset: offset?.toString(),
      }))
    if (current === revision) {
      page.value = {
        items:
          offset && page.value
            ? [...page.value.items, ...result.items]
            : result.items,
        nextOffset: result.nextOffset,
      }
    }
  }
  catch (error) {
    const message = await externalListRequestError(error)
    if (current === revision)
      problem.value = message
  }
  finally {
    if (current === revision)
      loading.value = false
  }
}

async function remove(titleId: string) {
  if (removing.value)
    return

  removing.value = titleId
  problem.value = undefined
  const target = profileId.value
  try {
    await withErrorMode('silent', () =>
      api.settings.deleteExternalListExclusion({ profileId: target, titleId }))
    await load()
  }
  catch (error) {
    problem.value = await externalListRequestError(error)
  }
  finally {
    removing.value = undefined
  }
}

watch([open, profileId], () => {
  revision++
  page.value = undefined
  loading.value = false
  problem.value = undefined
  void load()
})
onBeforeUnmount(() => revision++)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      :show-close-button="false"
    >
      <DialogHeader>
        <DialogTitle>{{ t(`${base}.exclusions`) }}</DialogTitle>
      </DialogHeader>

      <div class="grid min-w-0 gap-2">
        <Label :for="selectId">{{ t(`${base}.profile`) }}</Label>
        <Select v-model="profileId" :disabled="!!removing">
          <SelectTrigger :id="selectId" class="w-full">
            <SelectValue :placeholder="t(`${base}.profile`)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="profile in profiles"
              :key="profile.id"
              :value="profile.id"
            >
              {{ profile.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Alert v-if="problem" variant="destructive" role="alert">
        <AlertDescription>{{ t(problem) }}</AlertDescription>
      </Alert>
      <Skeleton v-if="loading && !page" class="h-12" aria-busy="true" />
      <div v-else-if="page" class="grid gap-3">
        <p v-if="!page.items.length" class="text-muted-foreground">
          {{ t(`${base}.exclusionsEmpty`) }}
        </p>
        <ul v-else class="divide-y rounded-lg border">
          <li
            v-for="item in page.items"
            :key="item.titleId"
            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <span class="min-w-0 break-all">{{
              item.title ?? item.titleId
            }}</span>
            <LoadingButton
              size="sm"
              variant="outline"
              :loading="removing === item.titleId"
              :disabled="!!removing || loading"
              @click="remove(item.titleId)"
            >
              {{ t(`${base}.resetExclusion`) }}
            </LoadingButton>
          </li>
        </ul>

        <LoadingButton
          v-if="page.nextOffset !== null"
          class="justify-self-start"
          variant="outline"
          size="sm"
          :loading="loading"
          :disabled="!!removing"
          @click="load(page.nextOffset)"
        >
          {{ t("panel.logs.showMore") }}
        </LoadingButton>
      </div>
      <DialogFooter>
        <Button variant="outline" :disabled="!!removing" @click="open = false">
          {{ t("panel.common.close") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
