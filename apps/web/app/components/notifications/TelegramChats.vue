<script setup lang="ts">
import type { TelegramChats } from '@torsher/api-client'
import { useField } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import LoadingButton from '~/components/LoadingButton.vue'

const props = defineProps<{
  token?: string
  // Сохранённый канал: токен берётся на сервере, в форму он не приходит
  channelId?: string
}>()

const { t } = useI18n()
const { findTelegramChats } = useNotificationChannels()
const { value: chatId, setValue } = useField<string>('config.chatId')

const result = shallowRef<TelegramChats | null>(null)
const isSearching = ref(false)

const canSearch = computed(() =>
  Boolean(props.token?.trim() || props.channelId),
)

/** Чаты, которые писали боту: владелец выбирает, а не ищет числовой ID */
async function search() {
  isSearching.value = true

  try {
    result.value = await findTelegramChats({
      token: props.token?.trim() || undefined,
      id: props.token?.trim() ? undefined : props.channelId,
    })

    const chats = result.value.chats

    if (chats.length === 1 && !chatId.value)
      setValue(chats[0]!.id)
  }
  catch {
    // Ошибку запроса уже показал тостом клиент API
  }
  finally {
    isSearching.value = false
  }
}
</script>

<template>
  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <LoadingButton
        type="button"
        variant="outline"
        size="sm"
        :loading="isSearching"
        :disabled="!canSearch"
        @click="search"
      >
        {{ t("panel.notifications.telegram.find") }}
      </LoadingButton>
      <span class="text-[12.5px] text-muted-foreground">
        {{ t("panel.notifications.telegram.findHint") }}
      </span>
    </div>

    <p
      v-if="result && !result.ok"
      class="text-[12.5px] text-destructive"
      aria-live="polite"
    >
      {{ t(`panel.notifications.test.errors.${result.kind ?? "unavailable"}`) }}
    </p>
    <p
      v-else-if="result && !result.chats.length"
      class="text-[12.5px] text-muted-foreground"
      aria-live="polite"
    >
      {{ t("panel.notifications.telegram.none") }}
    </p>
    <ul v-else-if="result" class="grid gap-1.5" aria-live="polite">
      <li v-for="chat in result.chats" :key="chat.id">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg border border-input px-3 py-2 text-left text-[13px] outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
          :class="chatId === chat.id && 'border-primary'"
          :aria-pressed="chatId === chat.id"
          @click="setValue(chat.id)"
        >
          <span class="min-w-0 truncate">{{ chat.title }}</span>
          <span class="shrink-0 font-mono text-[12px] text-muted-foreground">{{
            chat.id
          }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
