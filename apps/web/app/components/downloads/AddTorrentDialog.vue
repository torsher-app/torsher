<script setup lang="ts">
import type { TorrentErrorKind } from '~/composables/useTorrents'
import { CircleAlertIcon, FileUpIcon, LinkIcon } from '@lucide/vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LoadingButton from '~/components/LoadingButton.vue'
import { torrentErrorKind } from '~/composables/useTorrents'
import { dialogSheetClass } from '~/lib/dialog'
import { readFileAsBase64, TORRENT_FILE_MAX_BYTES } from '~/lib/torrents'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { addTorrent } = useTorrents()

const serverError = ref<TorrentErrorKind | null>(null)

// Правило magnet совпадает с сервером: он примет только ссылку с infohash v1
const schema = computed(() =>
  toTypedSchema(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('magnet'),
        magnet: z
          .string()
          .trim()
          .regex(
            /^magnet:\?\S*xt=urn:btih:[0-9a-z]{32,40}/i,
            t('panel.torrents.validation.magnet'),
          ),
        file: z.any().optional(),
      }),
      z.object({
        kind: z.literal('file'),
        magnet: z.string().optional(),
        file: z
          .instanceof(File, { message: t('panel.torrents.validation.file') })
          .refine(
            file => file.size <= TORRENT_FILE_MAX_BYTES,
            t('panel.torrents.validation.fileSize'),
          ),
      }),
    ]),
  ),
)

const {
  handleSubmit,
  defineField,
  errors,
  isSubmitting,
  resetForm,
  setFieldValue,
} = useForm({
  validationSchema: schema,
  initialValues: {
    kind: 'magnet' as 'magnet' | 'file',
    magnet: '',
    file: undefined as File | undefined,
  },
})

const [kind, kindProps] = defineField('kind')
const [magnet, magnetProps] = defineField('magnet')
const [file] = defineField('file')

const isEngineError = computed(
  () =>
    serverError.value === 'not_installed'
    || serverError.value === 'starting'
    || serverError.value === 'stopped',
)

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement

  setFieldValue('file', input.files?.[0])
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    serverError.value = null
  }
})

const onSubmit = handleSubmit(async (values) => {
  serverError.value = null

  try {
    const { torrent: added, existed } = await addTorrent(
      values.kind === 'magnet'
        ? { magnet: values.magnet }
        : { torrentFile: await readFileAsBase64(values.file) },
    )

    open.value = false

    if (existed) {
      toast.info(t('panel.torrents.addDialog.exists'))
      return
    }

    toast.success(t('panel.torrents.addDialog.added'), {
      description:
        added.status === 'resolving'
          ? t('panel.torrents.addDialog.addedResolving')
          : t('panel.torrents.addDialog.addedFiles', added.files.length),
    })
  }
  catch (err) {
    serverError.value = await torrentErrorKind(err)
  }
})

const choiceClass
  = 'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-input p-3.5 has-[[data-state=checked]]:border-primary'
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :class="dialogSheetClass">
      <DialogHeader>
        <DialogTitle>{{ t("panel.torrents.addDialog.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("panel.torrents.addDialog.description") }}
        </DialogDescription>
      </DialogHeader>

      <form id="add-torrent" class="grid gap-4" novalidate @submit="onSubmit">
        <Alert
          v-if="serverError"
          :variant="isEngineError ? 'warning' : 'destructive'"
        >
          <CircleAlertIcon />
          <AlertTitle>
            {{ t(`panel.torrents.errorTitles.${serverError}`) }}
          </AlertTitle>
          <AlertDescription>
            {{ t(`panel.torrents.errors.${serverError}`) }}
          </AlertDescription>
        </Alert>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">
            {{ t("panel.torrents.addDialog.kind") }}
          </legend>
          <RadioGroup
            v-model="kind"
            v-bind="kindProps"
            class="grid gap-2.5 sm:grid-cols-2"
          >
            <Label :class="choiceClass">
              <RadioGroupItem value="magnet" class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="flex items-center gap-1.5 font-medium">
                  <LinkIcon class="size-3.5" aria-hidden="true" />
                  {{ t("panel.torrents.addDialog.magnetTitle") }}
                </span>
                <span class="text-[12.5px] font-normal text-muted-foreground">
                  {{ t("panel.torrents.addDialog.magnetText") }}
                </span>
              </span>
            </Label>
            <Label :class="choiceClass">
              <RadioGroupItem value="file" class="mt-0.5" />
              <span class="grid gap-0.5">
                <span class="flex items-center gap-1.5 font-medium">
                  <FileUpIcon class="size-3.5" aria-hidden="true" />
                  {{ t("panel.torrents.addDialog.fileTitle") }}
                </span>
                <span class="text-[12.5px] font-normal text-muted-foreground">
                  {{ t("panel.torrents.addDialog.fileText") }}
                </span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>

        <div v-if="kind === 'magnet'" class="grid gap-2">
          <Label for="torrent-magnet">{{
            t("panel.torrents.addDialog.magnet")
          }}</Label>
          <Input
            id="torrent-magnet"
            v-model="magnet"
            v-bind="magnetProps"
            autocomplete="off"
            spellcheck="false"
            class="font-mono text-xs"
            placeholder="magnet:?xt=urn:btih:…"
            :aria-invalid="
              !!errors.magnet || serverError === 'invalid' || undefined
            "
            aria-describedby="torrent-magnet-hint"
          />
          <p
            v-if="errors.magnet"
            id="torrent-magnet-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.magnet }}
          </p>
          <p
            v-else
            id="torrent-magnet-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ t("panel.torrents.addDialog.magnetHint") }}
          </p>
        </div>

        <div v-else class="grid gap-2">
          <Label for="torrent-file">{{
            t("panel.torrents.addDialog.file")
          }}</Label>
          <Input
            id="torrent-file"
            type="file"
            accept=".torrent,application/x-bittorrent"
            :aria-invalid="
              !!errors.file || serverError === 'invalid' || undefined
            "
            aria-describedby="torrent-file-hint"
            @change="onFileChange"
          />
          <p
            v-if="errors.file"
            id="torrent-file-hint"
            class="text-[12.5px] text-destructive"
          >
            {{ errors.file }}
          </p>
          <p
            v-else
            id="torrent-file-hint"
            class="text-[12.5px] text-muted-foreground"
          >
            {{ file ? file.name : t("panel.torrents.addDialog.fileHint") }}
          </p>
        </div>
      </form>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isSubmitting"
          @click="open = false"
        >
          {{ t("panel.common.cancel") }}
        </Button>
        <LoadingButton type="submit" form="add-torrent" :loading="isSubmitting">
          {{ t("panel.torrents.addDialog.submit") }}
        </LoadingButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
