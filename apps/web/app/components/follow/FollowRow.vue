<script setup lang="ts">
import type { FollowSummary } from '@torsher/api-client'
import {
  EllipsisIcon,
  EyeIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  Trash2Icon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import ProfileAvatar from '~/components/people/ProfileAvatar.vue'
import { followStatusOf } from '~/lib/follow'
import { toneText } from '~/lib/indexerStatus'

const props = defineProps<{
  follow: FollowSummary
  selected: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  open: []
  search: []
  togglePause: []
  delete: []
}>()

const { t } = useI18n()
const text = useFollowText()

const view = computed(() => followStatusOf(props.follow))
const name = computed(() => props.follow.title ?? props.follow.titleId)
const isPaused = computed(() => props.follow.state === 'paused')
// Остановленное (никто не подписан) возобновляет подписка на ТВ, а не владелец
const canPause = computed(
  () => props.follow.state === 'active' || props.follow.state === 'paused',
)
</script>

<template>
  <!-- Строку открывает кнопка-имя на всю строку: «⋯» лежит поверх неё -->
  <li
    :class="
      cn(
        'group/row relative grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] hover:bg-muted/50 dark:hover:bg-muted',
        'md:h-14 md:grid-cols-[28px_minmax(0,1.3fr)_minmax(0,1fr)_88px_36px] md:py-0',
        selected
          && 'bg-muted/50 dark:bg-muted shadow-[inset_2px_0_0_var(--primary)]',
      )
    "
  >
    <span
      class="row-span-2 grid h-10 w-7 place-items-center self-start overflow-hidden rounded bg-muted text-muted-foreground md:row-span-1 md:self-center"
      aria-hidden="true"
    >
      <img
        v-if="follow.poster"
        :src="follow.poster"
        alt=""
        class="size-full object-cover"
        loading="lazy"
      >
      <EyeIcon v-else class="size-3.5" />
    </span>

    <span class="col-start-2 row-start-1 grid min-w-0">
      <button
        type="button"
        class="min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        :aria-current="selected || undefined"
        @click="emit('open')"
      >
        {{ name
        }}<span
          v-if="follow.year"
          class="ml-1.5 font-normal text-muted-foreground tabular-nums"
        >{{ follow.year }}</span>
      </button>
      <span class="truncate text-[12.5px] text-muted-foreground">
        {{ text.policy(follow) }}
      </span>
    </span>

    <span
      class="col-span-2 col-start-2 row-start-2 flex min-w-0 items-center gap-2 text-[13px] whitespace-nowrap md:col-span-1 md:col-start-3 md:row-start-1"
    >
      <component
        :is="view.icon"
        :class="cn('size-4 shrink-0 -translate-y-px', toneText[view.tone])"
        aria-hidden="true"
      />
      <span
        class="truncate"
        :class="
          view.tone === 'destructive' || view.tone === 'warning'
            ? toneText[view.tone]
            : undefined
        "
      >
        {{ text.status(follow, view) }}
      </span>
    </span>

    <!-- Подписанные профили: кто ждёт этот тайтл -->
    <span
      class="hidden items-center -space-x-1 md:col-start-4 md:row-start-1 md:flex"
      :aria-label="
        t('panel.follow.profilesLabel', {
          names: follow.profiles.map((item) => item.name).join(', '),
        })
      "
    >
      <ProfileAvatar
        v-for="profile in follow.profiles.slice(0, 4)"
        :key="profile.id"
        :name="profile.name"
        :color="profile.color"
        class="ring-2 ring-background"
      />
      <span
        v-if="follow.profiles.length > 4"
        class="pl-2 text-xs text-muted-foreground tabular-nums"
      >+{{ follow.profiles.length - 4 }}</span>
    </span>

    <span
      class="col-start-3 row-start-1 flex items-center justify-end md:col-start-5"
    >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="relative size-7 md:opacity-50 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100 md:aria-expanded:opacity-100"
            :class="{ 'md:opacity-100': selected }"
            :aria-label="t('panel.follow.actions.menu', { name })"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-48">
          <DropdownMenuItem
            :disabled="busy || follow.state !== 'active'"
            @select="emit('search')"
          >
            <SearchIcon aria-hidden="true" />
            {{ t("panel.follow.actions.searchNow") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="canPause"
            :disabled="busy"
            @select="emit('togglePause')"
          >
            <component
              :is="isPaused ? PlayIcon : PauseIcon"
              aria-hidden="true"
            />
            {{
              t(
                isPaused
                  ? "panel.follow.actions.resume"
                  : "panel.follow.actions.pause",
              )
            }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('delete')">
            <Trash2Icon aria-hidden="true" />
            {{ t("panel.follow.actions.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
