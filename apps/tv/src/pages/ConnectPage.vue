<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppLoader from '../components/AppLoader.vue'
import FocusSection from '../components/FocusSection.vue'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { usePairing } from '../composables/usePairing.ts'
import { formatCode, panelAddress } from '../lib/pairing.ts'
import { safeNext } from '../lib/session.ts'
import { platform } from '../platform/index.ts'
import {
  canReturnToShell,
  returnToShell,
  signInAsOwner,
} from '../platform/shell.ts'
import { resolveSession, session } from '../session.ts'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const isTv = platform === 'tv'
const address = panelAddress(window.location)

const { phase, code, retry, restart } = usePairing(async () => {
  await resolveSession()

  // Cookie устройства не сохранился: старый код уже погашен, нужен новый
  if (session.status === 'unpaired') {
    void restart()
    return
  }

  // Дальше решает гейт: выбор профиля или сразу туда, куда шли
  void router.replace(safeNext(route.query.next) ?? '/')
})

const loading = useHeldLoading(() => phase.value === 'loading')
</script>

<template>
  <main class="connect">
    <div class="connect__brand">
      <AppIcon name="brand" />
      <span class="connect__brand-name">Torsher</span>
    </div>

    <div class="connect__body">
      <div class="connect__guide">
        <h1 class="connect__title">
          {{ isTv ? t("connect.titleTv") : t("connect.titleWeb") }}
        </h1>
        <ol class="connect__steps">
          <li class="connect__step">
            <span class="connect__number">1</span>
            <span>
              {{ t("connect.openPanel") }}
              <span class="connect__address">{{ address }}</span>
            </span>
          </li>
          <li class="connect__step">
            <span class="connect__number">2</span>
            <span>{{ t("connect.openSection") }}</span>
          </li>
          <li class="connect__step">
            <span class="connect__number">3</span>
            <span>{{ t("connect.enterCode") }}</span>
          </li>
        </ol>

        <FocusSection name="connect-actions" autofocus>
          <button
            v-if="phase === 'error'"
            v-focusable
            class="action action--primary"
            type="button"
            @click="retry"
          >
            {{ t("state.retry") }}
          </button>
          <button
            v-focusable
            class="action"
            type="button"
            @click="signInAsOwner"
          >
            {{ t("connect.owner") }}
          </button>
          <button
            v-if="isTv && canReturnToShell"
            v-focusable
            class="action"
            type="button"
            @click="returnToShell(router.options.history)"
          >
            {{ t("about.changeServer") }}
          </button>
        </FocusSection>
      </div>

      <!-- Карточка кода держит размер во всех состояниях: экран не прыгает -->
      <div class="connect__card" aria-live="polite">
        <template v-if="phase === 'error' && !loading">
          <p class="connect__error">
            {{ t("connect.error") }}
          </p>
          <p class="connect__note">
            {{ t("connect.errorText") }}
          </p>
        </template>
        <AppLoader v-else-if="loading || !code" />
        <template v-else>
          <p class="connect__code">
            {{ formatCode(code) }}
          </p>
          <p class="connect__note">
            {{ t("connect.refreshes") }}
          </p>
        </template>
      </div>
    </div>
  </main>
</template>

<style scoped>
.connect {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  padding: var(--safe-y) var(--safe-x);
}

.connect__brand {
  display: flex;
  align-items: center;
  height: calc(var(--u) * 64);
  color: var(--color-accent);
  font-size: calc(var(--u) * 40);
}

.connect__brand-name {
  margin-left: calc(var(--u) * 18);
  color: var(--color-text);
  font-size: calc(var(--u) * 30);
  font-weight: 600;
}

.connect__body {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  padding-left: calc(var(--u) * 72);
}

.connect__guide {
  width: calc(var(--u) * 860);
}

.connect__title {
  margin: 0 0 var(--space-5);
  font-size: var(--font-size-xl);
  line-height: 1.15;
}

.connect__steps {
  margin: 0 0 var(--space-6);
  padding: 0;
  list-style: none;
}

.connect__step {
  display: flex;
  align-items: flex-start;
  margin-bottom: var(--space-4);
  font-size: var(--font-size-m);
}

.connect__number {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 48);
  height: calc(var(--u) * 48);
  margin: calc(var(--u) * -6) var(--space-3) 0 0;
  border-radius: 50%;
  background: var(--color-glass);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-weight: 600;
}

.connect__address {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-accent);
  font-size: var(--font-size-l);
  font-weight: 600;
}

.connect__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 720);
  height: calc(var(--u) * 420);
  margin-right: calc(var(--u) * 72);
  padding: var(--space-5);
  border-radius: var(--radius-l);
  background: var(--color-surface);
  text-align: center;
}

.connect__code {
  margin: 0 0 var(--space-3);
  font-size: calc(var(--u) * 120);
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.connect__note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.connect__error {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-l);
}
</style>
