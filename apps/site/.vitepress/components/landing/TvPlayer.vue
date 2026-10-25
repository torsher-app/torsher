<script setup lang="ts">
import { format, label } from '../../ui.ts'

/**
 * The player controls drawn from `apps/tv` (PlayerOsd): a movie with several
 * audio tracks and subtitles turned off. The clock uses the 12-hour format the
 * showcase picks for English.
 */
const remaining = format('player.remaining', { time: '47:48' })
const endsAt = format('player.endsAt', { time: '10:28 PM' })

const buttons = [
  {
    name: label('player.audio'),
    value: 'English',
    paths: ['M4 14.5v-5M8 18V6M12 21V3M16 18V6M20 14.5v-5'],
  },
  {
    name: label('player.subtitles'),
    value: label('player.subtitlesOff'),
    paths: [
      'M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z',
      'M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6',
    ],
  },
  {
    name: label('player.source.button'),
    value: '1080p · H.264',
    paths: ['M4 8h14l-3.5-3.5', 'M20 16H6l3.5 3.5'],
  },
]
</script>

<template>
  <div
    class="screen"
    role="img"
    aria-label="Torsher player playing a movie with the on-screen controls: Back, the title and file name, the clock and download speed, the timeline in focus, and the Audio, Subtitles, Source and Settings buttons"
  >
    <div class="picture" aria-hidden="true">
      <div class="moon" />
      <div class="peak peak-1" />
      <div class="peak peak-2" />
      <div class="snow" />
    </div>

    <div class="osd">
      <div class="scrim-top" />
      <div class="scrim-bottom" />

      <header>
        <div class="titles">
          <h1>Lanterns of Vell</h1>
          <p>Lanterns.of.Vell.2026.1080p.mkv</p>
        </div>
        <div class="status">
          <span class="clock">09:40 PM</span>
          <span class="net">
            <span class="bars" aria-hidden="true"><span /><span /><span /><span /></span>
            <span>{{ format("player.speed", { value: "6.2" }) }}</span>
          </span>
        </div>
      </header>

      <div class="bottom">
        <div class="timeline">
          <span class="track">
            <span class="buffered" />
            <span class="played" />
          </span>
          <span class="thumb" />
        </div>
        <div class="times">
          <span class="time-left">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 4.5v15l12.5-7.5z" />
            </svg>
            1:04:12
          </span>
          <span><b>{{ remaining }}</b> · {{ endsAt }}</span>
        </div>
        <div class="buttons">
          <span v-for="button in buttons" :key="button.name" class="button">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-for="d in button.paths" :key="d" :d="d" />
            </svg>
            <span class="button-text">{{ button.name
            }}<span class="button-value">{{ button.value }}</span></span>
          </span>
          <span class="button round" :title="label('player.settings.button')">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z" />
              <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
              <path
                d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"
                stroke-width="3"
              />
              <path
                d="M5.28 5.28l2.12 2.12M16.6 16.6l2.12 2.12M5.28 18.72l2.12-2.12M16.6 7.4l2.12-2.12"
                stroke-width="3"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>

    <span class="back">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m15 5-7 7 7 7" />
      </svg>
      <span>{{ label("common.back") }}</span>
    </span>
  </div>
</template>

<style scoped>
.screen {
  --u: calc(100cqw / 1920);

  position: relative;
  container-type: inline-size;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  background: #000;
  color: var(--color-text);
  font-family: var(--font-family);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.screen svg {
  display: block;
}

.picture,
.osd {
  position: absolute;
  inset: 0;
  font-size: calc(var(--u) * 28);
}

.picture {
  overflow: hidden;
  background: linear-gradient(180deg, #0c1624 0%, #1d3247 45%, #6d8798 70%, #dfe7ec 100%);
}

.picture > div {
  position: absolute;
}

.moon {
  top: calc(var(--u) * 130);
  left: calc(var(--u) * 1380);
  width: calc(var(--u) * 120);
  height: calc(var(--u) * 120);
  border-radius: 50%;
  background: radial-gradient(circle, #fbf6e8 0%, #e9e2cf 50%, rgba(233, 226, 207, 0) 72%);
}

.peak {
  right: 0;
  bottom: 0;
  left: 0;
}

.peak-1 {
  height: calc(var(--u) * 640);
  background: #4a6476;
  clip-path: polygon(0 58%, 14% 30%, 26% 48%, 40% 8%, 54% 40%, 66% 18%, 80% 44%, 92% 22%, 100% 36%, 100% 100%, 0 100%);
}

.peak-2 {
  height: calc(var(--u) * 420);
  background: #2c3f4d;
  clip-path: polygon(0 50%, 20% 24%, 34% 46%, 50% 16%, 64% 42%, 78% 20%, 100% 48%, 100% 100%, 0 100%);
}

.snow {
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(var(--u) * 200);
  background: linear-gradient(180deg, #c9d6de 0%, #eef3f6 100%);
  clip-path: polygon(0 40%, 30% 20%, 55% 45%, 80% 25%, 100% 40%, 100% 100%, 0 100%);
}

.scrim-top,
.scrim-bottom {
  position: absolute;
  right: 0;
  left: 0;
}

.scrim-top {
  top: 0;
  height: calc(var(--u) * 300);
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
}

.scrim-bottom {
  bottom: 0;
  height: calc(var(--u) * 520);
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.6) 55%, rgba(0, 0, 0, 0) 100%);
}

header {
  position: absolute;
  top: calc(var(--u) * 54);
  right: calc(var(--u) * 96);
  left: calc(var(--u) * 96);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.titles {
  min-width: 0;
  margin-right: calc(var(--u) * 48);
  padding-left: calc(var(--u) * 120);
}

.titles h1 {
  margin: 0 0 calc(var(--u) * 10);
  overflow: hidden;
  border: 0;
  padding: 0;
  color: inherit;
  font-size: calc(var(--u) * 56);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.titles p {
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 28);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: flex-end;
}

.clock {
  margin-bottom: calc(var(--u) * 12);
  font-size: calc(var(--u) * 36);
  font-weight: 600;
}

.net {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: calc(var(--u) * 44);
  padding: 0 calc(var(--u) * 18) 0 calc(var(--u) * 14);
  border-radius: calc(var(--u) * 22);
  background: var(--color-glass);
  font-size: calc(var(--u) * 24);
  font-weight: 500;
  white-space: nowrap;
}

.bars {
  display: inline-flex;
  align-items: flex-end;
  gap: calc(var(--u) * 2);
  width: calc(var(--u) * 26);
  height: calc(var(--u) * 20);
  margin-right: calc(var(--u) * 10);
}

.bars span {
  flex: 1;
  border-radius: calc(var(--u) * 2);
  background: currentColor;
}

.bars span:nth-child(1) {
  height: 25%;
}
.bars span:nth-child(2) {
  height: 50%;
}
.bars span:nth-child(3) {
  height: 75%;
}
.bars span:nth-child(4) {
  height: 100%;
}

.bottom {
  position: absolute;
  right: calc(var(--u) * 96);
  bottom: calc(var(--u) * 64);
  left: calc(var(--u) * 96);
}

.timeline {
  position: relative;
  height: calc(var(--u) * 64);
}

.track {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: calc(var(--u) * 8);
  margin-top: calc(var(--u) * -4);
  overflow: hidden;
  border-radius: calc(var(--u) * 4);
  background: rgba(255, 255, 255, 0.22);
  transform: scaleY(1.5);
}

.buffered,
.played {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
}

.buffered {
  width: 70%;
  background: rgba(255, 255, 255, 0.42);
}

.played {
  width: 57%;
  background: var(--color-accent);
}

.thumb {
  position: absolute;
  top: 50%;
  left: calc(57% - var(--u) * 12);
  width: calc(var(--u) * 24);
  height: calc(var(--u) * 24);
  margin-top: calc(var(--u) * -12);
  border-radius: 50%;
  background: #fff;
}

.times {
  display: flex;
  justify-content: space-between;
  margin: calc(var(--u) * 4) 0 calc(var(--u) * 26);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 24);
}

.times b {
  color: var(--color-text);
  font-weight: 600;
}

.time-left {
  display: inline-flex;
  align-items: center;
}

.time-left svg {
  width: calc(var(--u) * 22);
  height: calc(var(--u) * 22);
  margin-right: calc(var(--u) * 12);
  color: var(--color-text);
}

.buttons {
  display: flex;
}

.button {
  display: inline-flex;
  align-items: center;
  height: calc(var(--u) * 76);
  margin-right: calc(var(--u) * 18);
  padding: 0 calc(var(--u) * 26);
  border-radius: calc(var(--u) * 16);
  background: var(--color-glass);
  font-size: calc(var(--u) * 24);
  font-weight: 600;
  white-space: nowrap;
}

.button svg {
  flex-shrink: 0;
  width: calc(var(--u) * 28);
  height: calc(var(--u) * 28);
  margin-right: calc(var(--u) * 16);
}

.button-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.12;
}

.button-value {
  font-size: calc(var(--u) * 22);
  font-weight: 500;
  opacity: 0.72;
}

.button.round {
  justify-content: center;
  width: calc(var(--u) * 76);
  margin-right: 0;
  margin-left: auto;
  padding: 0;
  border-radius: 50%;
}

.button.round svg {
  margin: 0;
}

.back {
  position: absolute;
  z-index: 5;
  top: calc(var(--u) * 54);
  left: calc(var(--u) * 28);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: calc(var(--u) * 64);
  padding: 0 calc(var(--u) * 26) 0 calc(var(--u) * 18);
  border-radius: calc(var(--u) * 32);
  background: var(--color-glass);
  font-size: calc(var(--u) * 24);
  font-weight: 600;
}

.back svg {
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 10);
}
</style>
