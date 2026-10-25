<script setup lang="ts">
import { format, label } from '../../ui.ts'

/**
 * The showcase home screen drawn from `apps/tv`: the collapsed section rail,
 * the hero of the focused card and the first rows. Sizes are in the
 * showcase's own unit, one pixel of a 1920 px screen.
 */
const minutes = (n: number) => format('title.runtimeMinutes', { minutes: n })

const meta = [
  '2026',
  label('title.movie'),
  format('title.runtime', { hours: 1, minutes: 52 }),
  'Adventure, Fantasy',
]

const cards = [
  {
    title: 'Lanterns of Vell',
    left: 38,
    progress: 66,
    art: 'linear-gradient(160deg, #1b3348 0%, #4d6c80 55%, #c9ad85 100%)',
  },
  {
    title: 'Glasswing',
    left: 12,
    progress: 62,
    art: 'linear-gradient(160deg, #1c2a3a 0%, #3f6b7c 55%, #a9d4c8 100%)',
  },
  {
    title: 'Saltwater Lullaby',
    left: 51,
    progress: 18,
    art: 'linear-gradient(160deg, #1a222c 0%, #3b4a57 50%, #d0753f 100%)',
  },
  {
    title: 'The Quiet Orchard',
    left: 24,
    progress: 55,
    art: 'linear-gradient(160deg, #1f3d33 0%, #4f8f6a 55%, #cde8a8 100%)',
  },
  {
    title: 'Kites over Mareth',
    left: 9,
    progress: 70,
    art: 'linear-gradient(160deg, #2b1b14 0%, #7a4a2e 50%, #e2b07a 100%)',
  },
].map(card => ({
  ...card,
  meta: format('continue.remaining', { time: minutes(card.left) }),
}))

// Paths from the showcase's own icon set (AppIcon.vue)
const rail = [
  {
    name: 'search',
    paths: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-3.6-3.6'],
  },
  {
    name: 'home',
    active: true,
    paths: [
      'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
    ],
  },
  {
    name: 'movies',
    paths: [
      'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3z',
      'M7.5 3v18M16.5 3v18M3 8h4.5M3 16h4.5M16.5 8H21M16.5 16H21',
    ],
  },
  {
    name: 'series',
    paths: [
      'M4.5 5.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z',
      'm8.5 2.5 3.5 3 3.5-3M8 21.5h8',
    ],
  },
  {
    name: 'catalog',
    paths: [
      'M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
      'M15 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
      'M5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
      'M15 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    ],
  },
  {
    name: 'mine',
    paths: ['M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z'],
  },
  { name: 'library', paths: ['M5 4.5v15', 'M9.5 4.5v15', 'm14 5.5 4.5 13.5'] },
]

const settingsPaths = [
  'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z',
  'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
]
const settingsSpokes = [
  'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3',
  'M5.28 5.28l2.12 2.12M16.6 16.6l2.12 2.12M5.28 18.72l2.12-2.12M16.6 7.4l2.12-2.12',
]
</script>

<template>
  <div
    class="screen"
    role="img"
    aria-label="Torsher showcase home screen: Lanterns of Vell in the hero, the Continue watching row with the first card focused, and the collapsed section rail"
  >
    <div class="backdrop" aria-hidden="true">
      <div class="sun" />
      <div class="ridge ridge-1" />
      <div class="ridge ridge-2" />
      <div class="ridge ridge-3" />
      <div class="scrim-left" />
      <div class="scrim-bottom" />
    </div>

    <div class="hero">
      <h1>Lanterns of Vell</h1>
      <div class="meta">
        <template v-for="(part, i) in meta" :key="part">
          <span v-if="i" class="sep" />
          <span>{{ part }}</span>
        </template>
      </div>
      <p class="overview">
        A mapmaker crosses a frozen valley to relight the beacons that once
        guided travellers home.
      </p>
      <div class="hints">
        <span class="hint"><span class="key">OK</span>{{ label("home.hint.resume") }}</span>
      </div>
    </div>

    <div class="rows">
      <section class="row">
        <h2>{{ label("home.rows.continue") }}</h2>
        <div class="cards">
          <div
            v-for="(card, i) in cards"
            :key="card.title"
            class="card"
            :class="{ focused: i === 0 }"
          >
            <span class="frame" :style="{ background: card.art }">
              <span class="track"><span :style="{ width: `${card.progress}%` }" /></span>
              <span v-if="i === 0" class="ring" />
            </span>
            <span class="card-title">{{ card.title }}</span>
            <span class="card-meta">{{ card.meta }}</span>
          </div>
        </div>
      </section>
      <section class="row">
        <h2>{{ label("home.rows.trending") }}</h2>
      </section>
    </div>

    <nav class="rail" aria-hidden="true">
      <span class="brand">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M17 11.4v3.2" stroke-width="1" />
          <path
            d="M17 14.45a1.05 1.05 0 1 0 0 2.1a1.05 1.05 0 1 0 0-2.1z"
            fill="currentColor"
            stroke="none"
          />
          <path d="M7.5 3h9l3 7.5h-15z" />
          <path d="M12 10.5V21M8 21h8" />
        </svg>
      </span>
      <span
        v-for="item in rail"
        :key="item.name"
        class="item"
        :class="{ active: item.active }"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path v-for="d in item.paths" :key="d" :d="d" />
        </svg>
      </span>
      <span class="spacer" />
      <span class="item"><span class="avatar">A</span></span>
      <span class="item">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path v-for="d in settingsPaths" :key="d" :d="d" />
          <path v-for="d in settingsSpokes" :key="d" :d="d" stroke-width="3" />
        </svg>
      </span>
      <span class="item">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
          <path d="M12 11v5.5M12 7.5h.01" />
        </svg>
      </span>
    </nav>
  </div>
</template>

<style scoped>
.screen {
  --u: calc(100cqw / 1920);

  position: relative;
  container-type: inline-size;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: calc(var(--u) * 28);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.screen svg {
  display: block;
}

.backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: linear-gradient(180deg, #0e1a28 0%, #20384d 38%, #5f7f94 62%, #c9ad85 82%, #8a7a66 100%);
}

.backdrop > div {
  position: absolute;
}

.sun {
  top: calc(var(--u) * 150);
  right: calc(var(--u) * 300);
  width: calc(var(--u) * 110);
  height: calc(var(--u) * 110);
  border-radius: 50%;
  background: radial-gradient(circle, #fff1cf 0%, #ffd98a 45%, rgba(255, 217, 138, 0) 72%);
}

.ridge {
  right: 0;
  bottom: 0;
  left: 0;
}

.ridge-1 {
  height: calc(var(--u) * 560);
  background: #3a5568;
  clip-path: polygon(0 62%, 12% 36%, 22% 52%, 36% 14%, 48% 44%, 60% 22%, 72% 46%, 84% 10%, 100% 40%, 100% 100%, 0 100%);
}

.ridge-2 {
  height: calc(var(--u) * 380);
  background: #22323f;
  clip-path: polygon(0 55%, 18% 28%, 30% 50%, 46% 20%, 58% 44%, 70% 18%, 82% 40%, 92% 28%, 100% 46%, 100% 100%, 0 100%);
}

.ridge-3 {
  height: calc(var(--u) * 180);
  background: #141d26;
  clip-path: polygon(0 50%, 25% 20%, 50% 55%, 75% 25%, 100% 60%, 100% 100%, 0 100%);
}

.scrim-left,
.scrim-bottom {
  inset: 0;
}

.scrim-left {
  background: linear-gradient(
    90deg,
    #0b0d12 0%,
    rgba(11, 13, 18, 0.94) 22%,
    rgba(11, 13, 18, 0.55) 44%,
    rgba(11, 13, 18, 0) 66%
  );
}

.scrim-bottom {
  background: linear-gradient(
    0deg,
    #0b0d12 0%,
    rgba(11, 13, 18, 0.96) 36%,
    rgba(11, 13, 18, 0.4) 56%,
    rgba(11, 13, 18, 0) 72%
  );
}

.hero {
  position: absolute;
  z-index: 5;
  top: calc(var(--u) * 84);
  left: calc(var(--u) * 168);
  width: calc(var(--u) * 1000);
}

.hero h1 {
  margin: 0 0 calc(var(--u) * 22);
  border: 0;
  padding: 0;
  color: inherit;
  font-size: calc(var(--u) * 56);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: 0;
}

.meta {
  display: flex;
  align-items: center;
  max-width: calc(var(--u) * 900);
  margin-bottom: calc(var(--u) * 16);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 24);
  white-space: nowrap;
}

.sep {
  width: calc(var(--u) * 5);
  height: calc(var(--u) * 5);
  margin: 0 calc(var(--u) * 14);
  border-radius: 50%;
  background: var(--color-text-dim);
}

.overview {
  max-width: calc(var(--u) * 900);
  margin: 0;
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 28);
  line-height: 1.42;
}

.hints {
  display: flex;
  margin-top: calc(var(--u) * 22);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
}

.hint {
  display: inline-flex;
  align-items: center;
}

.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: calc(var(--u) * 40);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 10);
  padding: 0 calc(var(--u) * 8);
  border: calc(var(--u) * 2) solid var(--color-text-dim);
  border-radius: calc(var(--u) * 8);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 17);
  font-weight: 600;
}

.rows {
  position: absolute;
  z-index: 4;
  top: calc(var(--u) * 618);
  right: 0;
  left: 0;
}

.row {
  margin-bottom: calc(var(--u) * 52);
  padding-left: calc(var(--u) * 168);
}

.row h2 {
  margin: 0 0 calc(var(--u) * 18);
  border: 0;
  padding: 0;
  color: inherit;
  font-size: calc(var(--u) * 28);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0;
}

.cards {
  display: flex;
}

.card {
  position: relative;
  flex-shrink: 0;
  width: calc(var(--u) * 400);
  margin-right: calc(var(--u) * 28);
}

.card.focused {
  z-index: 2;
  transform: scale(1.06);
}

.frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: calc(var(--u) * 12);
}

.track {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(var(--u) * 6);
  overflow: hidden;
  border-radius: 0 0 calc(var(--u) * 12) calc(var(--u) * 12);
  background: rgba(255, 255, 255, 0.25);
}

.track span {
  display: block;
  height: 100%;
  background: var(--color-accent);
}

.ring {
  position: absolute;
  inset: calc(var(--u) * -8);
  border: calc(var(--u) * 4) solid var(--color-focus);
  border-radius: calc(var(--u) * 20);
}

.card-title,
.card-meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title {
  margin-top: calc(var(--u) * 16);
  font-size: calc(var(--u) * 26);
  font-weight: 600;
}

.card-meta {
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 24);
}

.rail {
  position: absolute;
  z-index: 30;
  top: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: calc(var(--u) * 120);
  padding: calc(var(--u) * 54) 0 calc(var(--u) * 54) calc(var(--u) * 28);
  color: var(--color-text-muted);
}

.brand {
  display: flex;
  align-items: center;
  height: calc(var(--u) * 64);
  margin-bottom: calc(var(--u) * 30);
  padding-left: calc(var(--u) * 12);
  color: var(--color-accent);
}

.brand svg {
  width: calc(var(--u) * 40);
  height: calc(var(--u) * 40);
}

.item {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: calc(var(--u) * 64);
  height: calc(var(--u) * 64);
  margin-bottom: calc(var(--u) * 10);
  padding-left: calc(var(--u) * 16);
}

.item svg {
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
}

.item.active {
  color: var(--color-text);
}

.item.active::before {
  position: absolute;
  top: calc(var(--u) * 20);
  left: calc(var(--u) * -14);
  width: calc(var(--u) * 6);
  height: calc(var(--u) * 24);
  border-radius: calc(var(--u) * 3);
  background: var(--color-accent);
  content: '';
}

.spacer {
  flex-grow: 1;
}

.avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
  border-radius: calc(var(--u) * 8);
  background: var(--color-profile-violet);
  color: #fff;
  font-size: calc(var(--u) * 18);
  font-weight: 600;
  line-height: 1;
}
</style>
