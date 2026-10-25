<script setup lang="ts">
interface Box {
  label: string
  note?: string
  x: number
  y: number
  w?: number
  h?: number
  ghost?: boolean
}

interface Line {
  x: number
  y: number
  dx?: number
  dy?: number
  arrow?: boolean
  dashed?: boolean
}

// Generic roles, not product names: the stack people usually assemble by hand
const before: Box[] = [
  { label: 'requests', note: ':5055', x: 30, y: 72 },
  { label: 'indexer', note: ':9696', x: 360, y: 72 },
  { label: 'tv-auto', note: ':8989', x: 30, y: 168 },
  { label: 'movie-auto', note: ':7878', x: 360, y: 168 },
  { label: 'torrent', note: ':8080', x: 195, y: 264 },
  { label: 'media', note: ':8096', x: 30, y: 360 },
  { label: 'stream', note: ':8090', x: 360, y: 360 },
  { label: 'tv', x: 195, y: 456, ghost: true },
]

const beforeLines: Line[] = [
  // Both the request manager and the indexer feed both automation apps
  { x: 105, y: 120, dy: 24 },
  { x: 435, y: 120, dy: 24 },
  { x: 105, y: 144, dx: 330 },
  { x: 105, y: 144, dy: 23, arrow: true },
  { x: 435, y: 144, dy: 23, arrow: true },
  { x: 105, y: 216, dy: 24 },
  { x: 435, y: 216, dy: 24 },
  { x: 105, y: 240, dx: 330 },
  { x: 270, y: 240, dy: 23, arrow: true },
  { x: 270, y: 312, dy: 24, dashed: true },
  { x: 105, y: 336, dx: 165, dashed: true },
  { x: 105, y: 336, dy: 23, arrow: true, dashed: true },
  { x: 105, y: 408, dy: 24 },
  { x: 435, y: 408, dy: 24 },
  { x: 105, y: 432, dx: 330 },
  { x: 270, y: 432, dy: 23, arrow: true },
]

const inside: Box[] = [
  { label: 'catalog', note: 'tmdb · cache', x: 54, y: 214 },
  { label: 'sources', note: 'torznab · magnet', x: 202, y: 214 },
  { label: 'engine', note: 'stream · seed', x: 350, y: 214 },
  { label: 'library', note: 'hard links', x: 54, y: 286 },
  { label: 'automation', note: 'follow · upgrade', x: 202, y: 286 },
  { label: 'playback', note: 'direct · remux', x: 350, y: 286 },
]

function boxStyle(box: Box) {
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w ?? 150}px`,
    height: `${box.h ?? 48}px`,
  }
}

function lineStyle(line: Line) {
  return {
    left: `${line.x - 1}px`,
    top: `${line.y}px`,
    width: `${line.dx ?? 2}px`,
    height: `${line.dy ?? 2}px`,
  }
}
</script>

<template>
  <div class="stack">
    <div
      class="panel"
      role="img"
      aria-label="Before: seven containers. A request manager and an indexer feed two automation apps, which send downloads to a torrent client; a media server and a separate streaming server both serve the TV."
    >
      <span
        v-for="(line, i) in beforeLines"
        :key="i"
        class="line"
        :class="{ arrow: line.arrow, dashed: line.dashed, horizontal: line.dx }"
        :style="lineStyle(line)"
      />
      <div class="head">
        <span class="tag">BEFORE</span>
        <span class="cmd">$ docker compose ps</span>
      </div>
      <div class="sub">
        7 services · 7 web UIs · 7 ports to remember
      </div>
      <div
        v-for="box in before"
        :key="box.label"
        class="box"
        :class="{ ghost: box.ghost }"
        :style="boxStyle(box)"
      >
        <span>{{ box.label }}
          <span v-if="box.note" class="note">{{ box.note }}</span></span>
      </div>
      <div class="copy-note">
        hard link or copy
      </div>
    </div>

    <div
      class="panel after"
      role="img"
      aria-label="After: one Torsher container with catalog, sources, engine, library, automation and playback inside. Only a Torznab indexer stays outside, and the container serves TVs and browsers."
    >
      <span
        class="line arrow accent"
        :style="lineStyle({ x: 270, y: 120, dy: 47 })"
      />
      <span
        class="line arrow accent"
        :style="lineStyle({ x: 270, y: 408, dy: 47 })"
      />
      <div class="frame" />
      <div class="head">
        <span class="tag accent">AFTER</span>
        <span class="cmd">$ docker compose ps</span>
      </div>
      <div class="sub">
        1 service · 1 port · 1 SQLite file
      </div>
      <div
        class="box ghost"
        :style="boxStyle({ label: '', x: 160, y: 72, w: 220 })"
      >
        <span>any torznab indexer</span>
      </div>
      <div class="title">
        <span class="name">torsher</span><span class="note"> :8080 · one container</span>
      </div>
      <div
        v-for="box in inside"
        :key="box.label"
        class="box inner"
        :style="boxStyle({ ...box, w: 136, h: 56 })"
      >
        <span>{{ box.label }}<br><span class="note small">{{
          box.note
        }}</span></span>
      </div>
      <div class="routes">
        routes: direct · socks5 · http · doh
      </div>
      <div
        class="box ghost"
        :style="boxStyle({ label: '', x: 120, y: 456, w: 300 })"
      >
        <span>tv · browser</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 40px;
  font-family: var(--vp-font-family-mono);
}

.panel {
  position: relative;
  flex: none;
  box-sizing: border-box;
  width: 540px;
  height: 528px;
  border: 1px solid var(--ld-line);
  border-radius: 20px;
  background: var(--ld-surface);
  color: var(--ld-text);
}

.panel.after {
  border-color: rgba(232, 184, 74, 0.45);
}

@container ld (max-width: 620px) {
  .panel {
    zoom: 0.62;
  }
}

.head {
  position: absolute;
  top: 22px;
  left: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  line-height: 16px;
}

/* Capitals sit high in the line box: a pixel of top padding centers them */
.tag {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 1px 8px 0;
  line-height: 1;
  border-radius: 6px;
  background: var(--ld-raised);
  font-weight: 600;
  letter-spacing: 0.06em;
}

.tag.accent {
  background: rgba(232, 184, 74, 0.16);
  color: var(--ld-accent-text);
}

.cmd,
.sub,
.note,
.copy-note,
.routes {
  color: var(--ld-muted);
}

.sub {
  position: absolute;
  top: 46px;
  left: 30px;
  font-size: 12px;
  line-height: 16px;
}

.box {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  background: var(--ld-bg);
  font-size: 14px;
  line-height: 18px;
  text-align: center;
}

.box.ghost {
  border-style: dashed;
  background: transparent;
  color: var(--ld-muted);
}

.box.inner {
  border-color: rgba(232, 184, 74, 0.35);
}

.note.small {
  font-size: 12px;
}

.copy-note {
  position: absolute;
  top: 316px;
  left: 280px;
  font-size: 12px;
  white-space: nowrap;
}

.frame {
  position: absolute;
  top: 168px;
  left: 30px;
  box-sizing: border-box;
  width: 480px;
  height: 240px;
  border: 1px dashed rgba(232, 184, 74, 0.6);
  border-radius: 14px;
  background: rgba(232, 184, 74, 0.06);
}

.title {
  position: absolute;
  top: 180px;
  left: 46px;
  font-size: 14px;
  line-height: 20px;
}

.title .name {
  color: var(--ld-accent-text);
  font-weight: 600;
}

.routes {
  position: absolute;
  top: 366px;
  left: 46px;
  font-size: 12px;
  line-height: 16px;
}

.line {
  position: absolute;
  background: var(--ld-muted);
  opacity: 0.6;
}

.line.dashed {
  background: repeating-linear-gradient(to bottom, var(--ld-muted) 0 4px, transparent 4px 8px);
}

.line.dashed.horizontal {
  background: repeating-linear-gradient(to right, var(--ld-muted) 0 4px, transparent 4px 8px);
}

.line.accent {
  background: var(--ld-accent);
  opacity: 1;
}

.line.arrow::after {
  position: absolute;
  bottom: -2px;
  left: -4px;
  border-top: 6px solid var(--ld-muted);
  border-right: 5px solid transparent;
  border-left: 5px solid transparent;
  content: '';
}

.line.arrow.accent::after {
  border-top-color: var(--ld-accent);
}
</style>
