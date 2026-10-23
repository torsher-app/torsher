<script setup lang="ts">
import tmdbLogo from '@torsher/tokens/assets/tmdb.svg'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppRail from '../components/AppRail.vue'
import FocusSection from '../components/FocusSection.vue'
import { useAbout } from '../composables/useAbout.ts'
import { platform } from '../platform/index.ts'
import { canReturnToShell, returnToShell } from '../platform/shell.ts'

const { t } = useI18n()
const router = useRouter()
const { status, about } = useAbout()

const RAIL_SECTION = 'rail-about'

// Сервер выбирают в обёртке ТВ; в браузере адрес и так в строке адреса
const isTv = platform === 'tv'
const server = window.location.host
</script>

<template>
  <main class="screen about">
    <h1 class="about__app">
      Torsher
    </h1>
    <p class="about__muted">
      © 2026 Anton Reshetov
    </p>

    <p v-if="status === 'error'" class="about__muted">
      {{ t("about.serverUnavailable") }}
    </p>
    <template v-else>
      <p v-if="about" class="about__muted">
        {{ t("about.license", { license: about.license }) }}
      </p>
      <dl class="facts" :aria-busy="status === 'loading'">
        <dt class="facts__label">
          {{ t("about.version") }}
        </dt>
        <dd class="facts__value">
          <span v-if="about">{{ about.version }}</span>
          <span v-else class="facts__skeleton skeleton" />
        </dd>
        <dt class="facts__label">
          {{ t("about.commit") }}
        </dt>
        <dd class="facts__value">
          <span v-if="about">{{ about.commit ?? t("about.unknown") }}</span>
          <span v-else class="facts__skeleton skeleton" />
        </dd>
        <dt class="facts__label">
          {{ t("about.source") }}
        </dt>
        <dd class="facts__value">
          <span v-if="about">{{ about.sourceUrl }}</span>
          <span v-else class="facts__skeleton skeleton" />
        </dd>
        <template v-if="isTv">
          <dt class="facts__label">
            {{ t("about.server") }}
          </dt>
          <dd class="facts__value">
            {{ server }}
          </dd>
        </template>
      </dl>
    </template>

    <!-- Атрибуция TMDB: логотип скромнее названия приложения, цвет и пропорции файла не меняем -->
    <section class="tmdb">
      <img class="tmdb__logo" :src="tmdbLogo" :alt="t('about.tmdbLogo')">
      <p class="tmdb__text">
        {{ t("about.dataSource") }}
      </p>
      <p class="tmdb__text about__muted">
        {{ t("about.tmdbNotice") }}
      </p>
      <p class="tmdb__text about__muted">
        {{ t("about.font") }}
      </p>
    </section>

    <FocusSection
      name="about-actions"
      :edges="{ left: RAIL_SECTION }"
      autofocus
    >
      <button v-focusable class="action" type="button" @click="router.back()">
        {{ t("common.back") }}
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

    <!-- Атрибуция IMDb по их условиям, пока оценки включены. Ниже кнопок: строка
         появляется после ответа сервера и ничего не сдвигает -->
    <p v-if="about?.imdbAttribution" class="about__note about__muted">
      {{ t("about.imdbNotice") }}
    </p>
    <AppRail current="about" :section="RAIL_SECTION" content="about-actions" />
  </main>
</template>

<style scoped>
.about {
  max-width: calc(var(--content-x) + var(--u) * 1200);
}

.about__app {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xl);
}

.about__muted {
  margin: 0 0 var(--space-4);
  color: var(--color-text-muted);
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  grid-gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-6);
}

.facts__label {
  color: var(--color-text-muted);
}

.facts__value {
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.facts__skeleton {
  display: inline-block;
  width: calc(var(--u) * 320);
  height: var(--font-size-m);
  border-radius: var(--radius-s);
  vertical-align: middle;
}

.tmdb {
  margin-bottom: var(--space-5);
}

.about__note {
  margin: var(--space-5) 0 0;
  font-size: var(--font-size-s);
}

/* Задаём только высоту: ширина следует за пропорциями файла */
.tmdb__logo {
  display: block;
  height: calc(var(--u) * 32);
  margin-bottom: var(--space-3);
}

.tmdb__text {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-s);
}
</style>
