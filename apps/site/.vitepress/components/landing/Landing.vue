<script setup lang="ts">
import { withBase } from 'vitepress'
</script>

<template>
  <section class="landing">
    <img
      class="mark"
      :src="withBase('/logo.svg')"
      alt=""
      width="96"
      height="96"
    >
    <p class="badge">
      <span>In development</span> · <span>Open source under AGPL-3.0</span>
    </p>
    <h1>Your home cinema in one container.</h1>
    <p class="intro">
      A TV-first catalog, watching a torrent right away, your own library and
      new episodes on their own — in one Docker container on your mini PC, NAS
      or desktop.
    </p>
    <div class="actions">
      <a class="primary" :href="withBase('/docs/install/docker-compose')">Install with Docker</a>
      <a class="secondary" :href="withBase('/docs/')">Read the docs</a>
    </div>
  </section>
</template>

<style scoped>
.landing {
  max-width: 760px;
  margin: 0 auto;
  padding: 96px 24px 128px;
  text-align: center;
}

.mark {
  margin: 0 auto 32px;
  border-radius: 22px;
}

.badge {
  display: inline-block;
  padding: 4px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  text-wrap: balance;
}

.badge span {
  white-space: nowrap;
}

h1 {
  margin: 24px 0 16px;
  font-size: clamp(36px, 6vw, 56px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.intro {
  color: var(--vp-c-text-2);
  font-size: 18px;
  line-height: 1.6;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 40px;
}

.actions a {
  padding: 12px 24px;
  border-radius: 999px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.2s;
}

.primary {
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
}

.primary:hover {
  background: var(--vp-button-brand-hover-bg);
}

.secondary {
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.secondary:hover {
  border-color: var(--vp-c-brand-1);
}
</style>
