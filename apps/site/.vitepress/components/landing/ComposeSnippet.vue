<script setup lang="ts">
import { ref } from 'vue'
import example from '../../../../../docker-compose.example.yml?raw'

/**
 * The Torsher service from the install file without comments and optional
 * lines: the snippet follows the repository file instead of a copy.
 */
function torsherService(source: string) {
  const lines: string[] = []
  let inServices = false

  for (const line of source.split('\n')) {
    if (line.trim().startsWith('#') || !line.trim())
      continue
    if (line === 'services:') {
      inServices = true
      lines.push(line)
      continue
    }
    // The next service at the same depth ends the Torsher one
    if (inServices && /^ {2}\S/.test(line) && lines.length > 1)
      break
    if (inServices)
      lines.push(line.replace(/\s+#.*$/, ''))
  }

  return lines
}

const lines = torsherService(example).map((line) => {
  const body = line.trimStart()
  const indent = line.slice(0, line.length - body.length)
  const colon = body.indexOf(':')

  return body.startsWith('-') || colon < 0
    ? { indent, key: '', value: body }
    : { indent, key: body.slice(0, colon), value: body.slice(colon) }
})

const text = lines
  .map(line => line.indent + line.key + line.value)
  .join('\n')
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(`${text}\n`)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  }
  catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="compose">
    <div class="bar">
      <span class="ld-mono name">docker-compose.yml</span>
      <button type="button" class="copy" @click="copy">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
        <span>{{ copied ? "Copied" : "Copy" }}</span>
      </button>
    </div>
    <pre
      class="ld-mono code"
    ><code><span v-for="(line, i) in lines" :key="i" class="line">{{ line.indent }}<span class="key">{{ line.key }}</span>{{ line.value }}</span></code></pre>
  </div>
</template>

<style scoped>
.compose {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ld-line);
  border-radius: 18px;
  background: var(--ld-surface);
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 12px 20px;
  border-bottom: 1px solid var(--ld-line);
}

.name {
  color: var(--ld-muted);
  font-size: 13px;
}

.copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  color: var(--ld-text);
  font-size: 13px;
  cursor: pointer;
}

.copy:hover {
  border-color: var(--ld-muted);
}

.copy svg {
  width: 14px;
  height: 14px;
}

.code {
  margin: 0;
  padding: 20px;
  overflow-x: auto;
  font-size: 13.5px;
  line-height: 1.75;
}

.line {
  display: block;
  white-space: pre;
}

.key {
  color: var(--color-info);
}

:root:not(.dark) .key {
  color: #2457b5;
}
</style>
