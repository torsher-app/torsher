<script setup lang="ts">
import type { SeedTimeUnit } from '~/lib/torrentSettings'
import { useField } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_RULE, SEED_MODES } from '~/lib/torrentSettings'

/**
 * Поля правила раздачи внутри формы родителя (`seedRuleSchema`): вариант,
 * рейтинг или время. Общие у «Настройки → Торрент» и карточки загрузки
 */
const props = defineProps<{
  idPrefix: string
  /** «Как в настройках: …» — первый вариант у отдельной загрузки */
  defaultLabel?: string
}>()

const { t } = useI18n()
const { value: mode } = useField<string>('mode')
const { value: ratio, errorMessage: ratioError } = useField<string>('ratio')
const { value: amount, errorMessage: amountError } = useField<string>('amount')
const { value: unit } = useField<SeedTimeUnit>('unit')

const modeId = `${props.idPrefix}-mode`
const ratioId = `${props.idPrefix}-ratio`
const amountId = `${props.idPrefix}-amount`
</script>

<template>
  <div class="grid gap-3">
    <div class="grid gap-2">
      <Label :for="modeId">{{
        t("panel.settings.torrent.seedRule.label")
      }}</Label>
      <Select v-model="mode">
        <SelectTrigger :id="modeId" class="w-full max-w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-if="defaultLabel" :value="DEFAULT_RULE">
            {{ defaultLabel }}
          </SelectItem>
          <SelectItem v-for="item in SEED_MODES" :key="item" :value="item">
            {{ t(`panel.settings.torrent.seedRule.modes.${item}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="mode === 'ratio'" class="grid gap-2">
      <Label :for="ratioId">{{
        t("panel.settings.torrent.seedRule.ratio")
      }}</Label>
      <Input
        :id="ratioId"
        v-model="ratio"
        inputmode="decimal"
        autocomplete="off"
        class="w-full max-w-24 tabular-nums"
        :aria-invalid="!!ratioError || undefined"
      />
      <p v-if="ratioError" class="text-[12.5px] text-destructive">
        {{ ratioError }}
      </p>
      <p v-else class="text-[12.5px] text-muted-foreground">
        {{ t("panel.settings.torrent.seedRule.ratioHint") }}
      </p>
    </div>

    <div v-else-if="mode === 'time'" class="grid gap-2">
      <Label :for="amountId">{{
        t("panel.settings.torrent.seedRule.time")
      }}</Label>
      <div class="flex gap-2">
        <Input
          :id="amountId"
          v-model="amount"
          inputmode="numeric"
          autocomplete="off"
          class="w-24 tabular-nums"
          :aria-invalid="!!amountError || undefined"
        />
        <Select v-model="unit">
          <SelectTrigger
            class="w-32"
            :aria-label="t('panel.settings.torrent.seedRule.time')"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hours">
              {{ t("panel.settings.torrent.seedRule.hours") }}
            </SelectItem>
            <SelectItem value="days">
              {{ t("panel.settings.torrent.seedRule.days") }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p v-if="amountError" class="text-[12.5px] text-destructive">
        {{ amountError }}
      </p>
      <p v-else class="text-[12.5px] text-muted-foreground">
        {{ t("panel.settings.torrent.seedRule.timeHint") }}
      </p>
    </div>
  </div>
</template>
