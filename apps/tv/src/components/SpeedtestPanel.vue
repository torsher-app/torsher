<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSpeedtest } from '../composables/useSpeedtest.ts'
import ActionButton from './ActionButton.vue'
import OptionsPanel from './OptionsPanel.vue'

const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()
const localTest = useSpeedtest('local')
const internetTest = useSpeedtest('internet')
const server = computed(() => internetTest.internet.value.result)
const result = computed(() => localTest.state.value.result)
function number(n: number | null | undefined, digits = 0) {
  return n == null
    ? '—'
    : n.toLocaleString(locale.value.replace('_', '-'), {
        maximumFractionDigits: digits,
        useGrouping: false,
      })
}
function retryTime(value: string) {
  return new Date(value).toLocaleString(locale.value.replace('_', '-'), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
function close() {
  localTest.stop()
  internetTest.stop()
  emit('close')
}
</script>

<template>
  <OptionsPanel :title="t('speedtest.title')" @close="close">
    <div class="speedtest">
      <p class="speedtest__muted">
        {{ t("speedtest.combinedNote") }}
      </p>
      <p class="speedtest__muted">
        {{ t("speedtest.combinedBudget") }}
      </p>
      <section class="speedtest__section">
        <h3 class="speedtest__heading">
          {{ t("speedtest.localDirection") }}
        </h3>
        <ActionButton
          v-focusable
          primary
          :disabled="internetTest.running.value"
          :label="
            t(localTest.running.value ? 'speedtest.stop' : 'speedtest.start')
          "
          @click="
            localTest.running.value ? localTest.stop() : localTest.start()
          "
        />
        <p role="status">
          {{ t(`speedtest.states.${localTest.state.value.status}`) }}
        </p>
        <p v-if="localTest.state.value.error" role="alert">
          {{ t(`speedtest.errors.${localTest.state.value.error}`) }}
        </p>
        <div class="speedtest__speed">
          {{
            number(
              result?.bytesPerSecond == null
                ? null
                : (result.bytesPerSecond * 8) / 1000000,
            )
          }}
          <span>{{ t("speedtest.mbps") }}</span>
        </div>
        <p v-if="result" class="speedtest__muted speedtest__summary">
          {{ number(result.durationMs / 1000) }} {{ t("speedtest.seconds") }} ·
          {{ number(result.payloadBytes / 1048576) }} MiB
        </p>
        <dl v-if="result" class="speedtest__details">
          <div>
            <dt>{{ t("speedtest.latency") }}</dt>
            <dd>{{ number(result.latencyMs) }} {{ t("speedtest.ms") }}</dd>
          </div>
          <div>
            <dt>{{ t("speedtest.startedAt") }}</dt>
            <dd>
              {{
                new Date(result.startedAt).toLocaleTimeString(
                  locale.replace("_", "-"),
                )
              }}
            </dd>
          </div>
        </dl>
        <p v-if="result?.shortened">
          {{ t("speedtest.shortened") }}
        </p>
      </section>
      <section class="speedtest__section">
        <h3 class="speedtest__heading">
          {{ t("speedtest.internetTitle") }}
        </h3>
        <p class="speedtest__muted">
          {{ t("speedtest.internetDirection") }}
        </p>
        <ActionButton
          v-focusable
          primary
          :disabled="localTest.running.value"
          :label="
            t(internetTest.running.value ? 'speedtest.stop' : 'speedtest.start')
          "
          @click="
            internetTest.running.value
              ? internetTest.stop()
              : internetTest.start()
          "
        />
        <p role="status">
          {{ t(`speedtest.states.${internetTest.internet.value.status}`) }}
        </p>
        <p v-if="internetTest.internet.value.error" role="alert">
          {{ t(`speedtest.errors.${internetTest.internet.value.error}`) }}
        </p>
        <p v-if="server?.state === 'running'">
          {{ t(`speedtest.phases.${server.phase}`) }}
        </p>
        <p
          v-if="
            server?.reason
              && !['complete', 'byte_limit', 'cancelled'].includes(server.reason)
          "
          role="alert"
        >
          {{
            server.providerHttpStatus === 429
              ? t("speedtest.providerLimited")
              : t(`speedtest.reasons.${server.reason}`)
          }}
          <span
            v-if="
              server.reason === 'provider_http_error'
                && server.providerHttpStatus !== undefined
            "
          >{{
            t("speedtest.httpStatus", { status: server.providerHttpStatus })
          }}</span>
          <span
            v-if="server.providerHttpStatus === 429 && server.providerRetryAt"
            class="speedtest__retry"
          >
            {{
              t("speedtest.retryAfter", {
                time: retryTime(server.providerRetryAt),
              })
            }}
          </span>
        </p>
        <div class="speedtest__rates">
          <div v-for="phase in ['download', 'upload'] as const" :key="phase">
            <h3>{{ t(`speedtest.${phase}`) }}</h3>
            <div class="speedtest__speed">
              {{
                number(
                  server?.[phase].bytesPerSecond == null
                    ? null
                    : (server[phase].bytesPerSecond * 8) / 1000000,
                )
              }}
              <span>{{ t("speedtest.mbps") }}</span>
            </div>
            <p v-if="server" class="speedtest__muted speedtest__summary">
              {{ number(server[phase].durationMs / 1000) }}
              {{ t("speedtest.seconds") }} ·
              {{ number(server[phase].payloadBytes / 1048576) }} MiB
            </p>
            <p
              v-if="
                server?.state === 'complete'
                  && server[phase].bytesPerSecond === null
              "
              class="speedtest__muted"
            >
              {{ t("speedtest.states.insufficient") }}
            </p>
          </div>
        </div>
        <dl v-if="server" class="speedtest__details">
          <div>
            <dt>{{ t("speedtest.latency") }}</dt>
            <dd>{{ number(server.latencyMs) }} {{ t("speedtest.ms") }}</dd>
          </div>
          <div>
            <dt>{{ t("speedtest.route") }}</dt>
            <dd>{{ t(`speedtest.routes.${server.route}`) }}</dd>
          </div>
          <div>
            <dt>{{ t("speedtest.startedAt") }}</dt>
            <dd>
              {{
                new Date(server.startedAt).toLocaleTimeString(
                  locale.replace("_", "-"),
                )
              }}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </OptionsPanel>
</template>

<style scoped>
.speedtest {
  font-size: var(--font-size-s);
}
.speedtest__section {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
}
.speedtest .action-button {
  margin-bottom: var(--space-3);
}
.speedtest .action-button:disabled {
  opacity: 0.4;
}
.speedtest__heading {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-m);
  font-weight: 600;
}
.speedtest p {
  margin: 0 0 var(--space-3);
}
.speedtest__muted {
  color: var(--color-text-muted);
}
.speedtest__retry {
  display: block;
}
.speedtest__speed {
  margin-bottom: var(--space-3);
  font-size: var(--font-size-xl);
  font-variant-numeric: tabular-nums;
}
.speedtest__speed span {
  font-size: var(--font-size-s);
  color: var(--color-text-muted);
}
.speedtest__rates {
  display: flex;
}
.speedtest__rates > * {
  flex: 1;
  min-width: 0;
}
.speedtest__rates > * + * {
  margin-left: var(--space-3);
}
.speedtest__summary {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.speedtest__rates h3 {
  margin: 0 0 var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-weight: 400;
}
.speedtest__details {
  margin: 0 0 var(--space-3);
  font-variant-numeric: tabular-nums;
}
.speedtest__details div {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-1);
}
.speedtest__details dt {
  color: var(--color-text-muted);
}
.speedtest__details dd {
  margin: 0 0 0 var(--space-2);
}
</style>
