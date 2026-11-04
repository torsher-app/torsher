<script setup lang="ts">
import type { MaintenanceStatus } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { dialogSheetClass } from '~/lib/dialog'
import MaintenanceRuleForm from './MaintenanceRuleForm.vue'

const props = defineProps<{ status: MaintenanceStatus }>()
const emit = defineEmits<{ saved: [] }>()
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { follows, state, load } = useFollows()
const search = ref('')
const opener = ref<HTMLElement>()
function openRule(id: string, event: MouseEvent) {
  opener.value = event.currentTarget as HTMLElement
  return select(id)
}
const selection = computed(() =>
  typeof route.query.rule === 'string' ? route.query.rule : '',
)
const titles = computed(
  () => new Map(follows.value.map(item => [item.titleId, item])),
)
function titleName(id: string) {
  return titles.value.get(id)?.title ?? id
}
const collator = computed(
  () => new Intl.Collator(locale.value.replace('_', '-'), { numeric: true }),
)
function compareTitles(a: { titleId: string }, b: { titleId: string }) {
  return collator.value.compare(titleName(a.titleId), titleName(b.titleId))
}
const rules = computed(() => [...props.status.rules].sort(compareTitles))
const savedIds = computed(
  () => new Set(rules.value.map(rule => rule.titleId)),
)
const choices = computed(() =>
  follows.value
    .filter(item => !savedIds.value.has(item.titleId))
    .sort(compareTitles),
)
const matches = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return choices.value.filter(item =>
    titleName(item.titleId).toLocaleLowerCase().includes(query),
  )
})
const common = computed(() => selection.value === 'default')
const selectedKind = computed(() =>
  common.value
    ? 'series'
    : (titles.value.get(selection.value)?.kind
      ?? (savedIds.value.has(selection.value)
        ? selection.value.startsWith('tmdb:movie:')
          ? 'movie'
          : 'series'
        : null)),
)
function select(id?: string) {
  search.value = ''
  return router.replace({
    query: { ...route.query, rule: id },
    hash: '#auto-delete',
  })
}
function ruleState(rule: MaintenanceStatus['rules'][number]) {
  if (!rule.enabled)
    return 'reasons.disabled'
  if (rule.rosterChanged)
    return 'reasons.profiles_changed'
  if (!props.status.executorEnabled)
    return 'waitingForExecution'
  if (rule.titleId === 'default')
    return 'enabledRule'
  const follow = titles.value.get(rule.titleId)
  if (follow?.state !== 'active' && follow?.state !== 'done')
    return 'reasons.follow_inactive'
  return 'enabledRule'
}
function saved() {
  emit('saved')
  void select()
}
onMounted(load)
</script>

<template>
  <section class="grid min-w-0 gap-2 border-t pt-3">
    <div class="grid gap-2">
      <h3 class="text-sm font-medium">
        {{ t("panel.maintenance.commonRule") }}
      </h3>
      <p class="text-sm text-muted-foreground">
        {{ t("panel.maintenance.commonScope") }}
      </p>
      <p class="text-sm">
        {{
          status.defaultRule.revision
            ? `${t("panel.maintenance.ruleDays", { days: status.defaultRule.days })} · ${t(`panel.maintenance.${ruleState(status.defaultRule)}`)}`
            : t("panel.maintenance.notConfigured")
        }}
      </p>
      <Button
        variant="outline"
        size="sm"
        class="justify-self-start"
        @click="openRule('default', $event)"
      >
        {{ t("panel.maintenance.configureDefault") }}
      </Button>
    </div>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-medium">
        {{ t("panel.maintenance.rules") }}
      </h3>
      <Button as-child variant="outline" size="sm">
        <button type="button" @click="openRule('new', $event)">
          {{ t("panel.maintenance.addRule") }}
        </button>
      </Button>
    </div>
    <p v-if="!rules.length" class="text-sm text-muted-foreground">
      {{ t("panel.maintenance.noRules") }}
    </p>
    <ul v-else class="grid divide-y rounded-lg border">
      <li v-for="rule in rules" :key="rule.titleId">
        <button
          class="grid w-full gap-1 px-3 py-2 text-start hover:bg-muted focus-visible:outline-ring"
          @click="openRule(rule.titleId, $event)"
        >
          <span class="break-words text-sm font-medium">{{
            titleName(rule.titleId)
          }}</span>
          <span v-if="rule.enabled" class="text-xs text-muted-foreground">{{ t("panel.maintenance.ruleDays", { days: rule.days }) }} ·
            {{ t(`panel.maintenance.${ruleState(rule)}`) }}</span>
          <span v-else class="text-xs text-muted-foreground">{{
            t("panel.maintenance.keepTitle")
          }}</span>
        </button>
      </li>
    </ul>

    <Dialog
      :open="!!selection"
      @update:open="
        (value) => {
          if (!value) select();
        }
      "
    >
      <DialogContent
        :class="dialogSheetClass"
        @close-auto-focus.prevent="opener?.focus()"
      >
        <DialogHeader>
          <DialogTitle>
            {{
              common
                ? t("panel.maintenance.commonRule")
                : selectedKind
                  ? titleName(selection)
                  : t("panel.maintenance.addRule")
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              t(
                selectedKind
                  ? "panel.maintenance.title"
                  : "panel.maintenance.chooseTitle",
              )
            }}
          </DialogDescription>
        </DialogHeader>
        <p v-if="!common && state === 'error'" role="alert">
          {{ t("panel.maintenance.loadTitlesError") }}
          <Button size="sm" variant="outline" @click="load">
            {{ t("panel.common.retry") }}
          </Button>
        </p>
        <Skeleton v-else-if="!common && state !== 'ready'" class="h-16" />
        <MaintenanceRuleForm
          v-else-if="selectedKind"
          :key="selection"
          :title-id="selection"
          :kind="selectedKind"
          @saved="saved"
        />
        <template v-else-if="selection === 'new'">
          <template v-if="choices.length">
            <Input
              v-model="search"
              type="search"
              :aria-label="t('panel.maintenance.findTitle')"
              :placeholder="t('panel.maintenance.findTitle')"
            />
            <ul
              v-if="matches.length"
              class="max-h-64 overflow-y-auto divide-y rounded-lg border"
            >
              <li v-for="item in matches" :key="item.titleId">
                <button
                  class="w-full px-3 py-2 text-start hover:bg-muted"
                  @click="select(item.titleId)"
                >
                  {{ titleName(item.titleId) }}
                  <span v-if="item.year" class="text-muted-foreground">{{
                    item.year
                  }}</span>
                </button>
              </li>
            </ul>
            <p v-else>
              {{ t("panel.maintenance.noMatches") }}
            </p>
          </template>
          <p v-else-if="follows.length">
            {{ t("panel.maintenance.allConfigured") }}
          </p>
          <p v-else>
            {{ t("panel.maintenance.noFollows") }}
          </p>
        </template>
        <p v-else>
          {{ t("panel.maintenance.missingTitle") }}
        </p>
      </DialogContent>
    </Dialog>
  </section>
</template>
