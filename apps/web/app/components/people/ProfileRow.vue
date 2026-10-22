<script setup lang="ts">
import type { Profile } from '@torsher/api-client'
import {
  EllipsisIcon,
  KeyRoundIcon,
  LockOpenIcon,
  PencilIcon,
  Trash2Icon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import ProfileAvatar from './ProfileAvatar.vue'

const props = defineProps<{
  profile: Profile
  selected: boolean
  isDefault: boolean
  canDelete: boolean
}>()

const emit = defineEmits<{
  open: []
  edit: []
  pin: []
  removePin: []
  delete: []
}>()

const { t } = useI18n()
const meta = useProfileMeta()

const language = computed(() => meta.languageOf(props.profile))
</script>

<template>
  <!-- Строку открывает кнопка-имя, растянутая на всю строку: меню «⋯» лежит поверх неё -->
  <li
    :class="
      cn(
        'group/row relative grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] hover:bg-muted/50 dark:hover:bg-muted',
        'sm:h-11 sm:grid-cols-[20px_minmax(0,190px)_minmax(0,1fr)_auto] sm:py-0',
        selected
          && 'bg-muted/50 dark:bg-muted shadow-[inset_2px_0_0_var(--primary)]',
      )
    "
  >
    <ProfileAvatar
      :name="profile.name"
      :color="profile.color"
      class="row-span-2 mt-1 self-start sm:row-span-1 sm:mt-0 sm:self-center"
    />
    <button
      type="button"
      class="col-start-2 row-start-1 min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      :aria-current="selected || undefined"
      @click="emit('open')"
    >
      {{ profile.name }}
    </button>
    <span
      class="col-span-2 col-start-2 row-start-2 flex min-w-0 items-baseline gap-1.5 text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-3 sm:row-start-1"
    >
      <span class="truncate">{{ language }}</span>
      <Badge v-if="profile.hasPin" variant="outline" class="shrink-0">
        {{ t("panel.people.profiles.pin") }}
      </Badge>
      <Badge v-if="profile.ageLimit" variant="outline" class="shrink-0">
        {{ t("panel.people.profiles.age", { age: profile.ageLimit }) }}
      </Badge>
      <span v-if="!profile.hasPin && !profile.ageLimit" class="truncate">
        · {{ t("panel.people.profiles.noLimits") }}
      </span>
    </span>
    <span
      class="col-start-3 row-start-1 flex items-center justify-end gap-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground sm:col-start-4"
    >
      <Badge v-if="isDefault" variant="secondary" class="hidden sm:inline-flex">
        {{ t("panel.people.profiles.default") }}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="relative size-7 sm:opacity-50 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100 sm:aria-expanded:opacity-100"
            :class="{ 'sm:opacity-100': selected }"
            :aria-label="
              t('panel.people.profiles.actions', { name: profile.name })
            "
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-48">
          <DropdownMenuItem @select="emit('edit')">
            <PencilIcon aria-hidden="true" />
            {{ t("panel.people.profiles.edit") }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="emit('pin')">
            <KeyRoundIcon aria-hidden="true" />
            {{
              t(
                profile.hasPin
                  ? "panel.people.profiles.changePin"
                  : "panel.people.profiles.setPin",
              )
            }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="profile.hasPin" @select="emit('removePin')">
            <LockOpenIcon aria-hidden="true" />
            {{ t("panel.people.profiles.removePin") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            :disabled="!canDelete"
            :title="
              canDelete ? undefined : t('panel.people.profiles.lastProfile')
            "
            @select="emit('delete')"
          >
            <Trash2Icon aria-hidden="true" />
            {{ t("panel.common.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
