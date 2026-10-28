<script setup lang="ts">
import { withBase } from 'vitepress'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { format, label } from '../../ui.ts'
import ComposeSnippet from './ComposeSnippet.vue'
import LampMark from './LampMark.vue'
import StackDiagram from './StackDiagram.vue'
import TvHome from './TvHome.vue'
import TvPlayer from './TvPlayer.vue'

const repoUrl = 'https://github.com/torsher-app/torsher'

// The closing lamp switches on when its section scrolls into view. The page
// renders it lit, so without scripts it still glows
const cta = ref<HTMLElement>()
const lampLit = ref(true)
const heroLit = ref(true)
let observer: IntersectionObserver | undefined

onMounted(() => {
  const section = cta.value

  if (!section || !('IntersectionObserver' in window))
    return

  // Already on screen, for example after a reload at the bottom: keep it lit
  if (section.getBoundingClientRect().top < window.innerHeight * 0.6)
    return

  lampLit.value = false
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some(entry => entry.isIntersecting))
        return
      observer?.disconnect()
      lampLit.value = true
    },
    { rootMargin: '0px 0px -35% 0px' },
  )
  observer.observe(section)
})

onBeforeUnmount(() => observer?.disconnect())

const features = [
  {
    title: 'Watch right away',
    text: 'Pick a title and press play. Torsher downloads a few minutes ahead of where you are and stops when you close the player, so nothing fills your disk by accident.',
  },
  {
    title: 'Watched it? Keep it.',
    text: 'Keep moves the file into your library, laid out by title. On one volume it is hard-linked, so it keeps seeding and takes no extra space. Folders you already have are added read-only.',
  },
  {
    title: 'New episodes arrive on their own',
    text: 'Follow a show and Torsher looks for each new episode under every name of the title, waits a while for a better release, and keeps the same voice-over for the whole season.',
  },
]

// The player timeline and the episode list of a followed show, as the
// showcase and the panel draw them
const playerTimes = {
  position: '4:12',
  remaining: format('player.remaining', { time: '5:48' }),
  endsAt: format('player.endsAt', { time: '09:46 PM' }),
}

const followSeason = format('panel.follow.card.season', { n: 2 })
const followEpisodes = [
  {
    code: 'E8',
    state: format('panel.follow.episodeStates.upcomingOn', {
      date: 'Fri, Oct 30',
    }),
    tone: 'muted',
  },
  {
    code: 'E7',
    state: label('panel.follow.episodeStates.downloading'),
    tone: 'info',
  },
  {
    code: 'E6',
    state: label('panel.follow.episodeStates.in_library'),
    tone: 'ok',
  },
]

const facts = [
  {
    title: 'Remote and pointer',
    text: 'Arrows, OK and Back, or the Magic Remote pointer and a mouse in any browser.',
  },
  {
    title: 'Continue anywhere',
    text: 'Progress belongs to the title, not the file: switch the release and keep your place.',
  },
  {
    title: 'Profiles for the family',
    text: 'Each profile has its own progress, lists, ratings and language, with an optional PIN.',
  },
  {
    title: 'Built for older TVs',
    text: 'Aimed at LG TVs from 2020: written for the browser engine they ship with, with animations kept to transform and opacity.',
  },
]

const audioPoints = [
  'Dubbing, multi-voice, single-voice or the original with subtitles',
  'The same voice-over for the whole season',
  'Scene release names and Russian-language ones, checked against a labeled corpus',
  'Season packs, episode ranges and ongoing seasons',
]

// What the release parser returns for the name in the card (an illustration, not a screen)
const parsed = [
  { label: 'Title', value: 'Quiet Harbor · Тихая гавань' },
  { label: 'Season', value: '2' },
  { label: 'Episodes', value: '1–8 of 10 · ongoing' },
  { label: 'Quality', value: '1080p · WEB-DL' },
  { label: 'Audio', value: label('sources.voiceTypes.MVO') },
  { label: 'Year', value: '2025' },
]

// Rows of the host check in the panel (Settings → Network)
const direct = label('panel.settings.network.via.direct')
const hosts = [
  {
    host: 'api.themoviedb.org',
    name: 'TMDB API',
    via: `${direct} · ${label('panel.settings.network.dns.quad9')}`,
    ms: 120,
  },
  {
    host: 'image.tmdb.org',
    name: 'TMDB images',
    via: `${direct} · ${label('panel.settings.network.dns.quad9')}`,
    ms: 84,
  },
  {
    host: 'indexer.example',
    name: 'Indexer A',
    via: `${label('panel.settings.network.via.socks5h')} 10.0.0.2:1080`,
    ms: 340,
  },
  {
    host: 'indexer-b.example',
    name: 'Indexer B',
    via: `${label('panel.settings.network.via.http')} 10.0.0.2:3128`,
    ms: 210,
  },
].map(host => ({
  ...host,
  ms: format('panel.settings.network.hosts.latency', { ms: host.ms }),
}))

const platforms = [
  {
    name: 'Web browser',
    stage: 'Available',
    ready: true,
    text: 'The showcase on any computer, and the control panel on a phone or a computer.',
  },
  {
    name: 'LG webOS',
    stage: 'Dev Mode',
    ready: true,
    text: 'A thin TV app that plays most files directly on the TV. For now it installs through Developer Mode.',
  },
  {
    name: 'Android TV',
    stage: 'APK',
    ready: true,
    text: 'The same showcase with a native player. For now it installs from the APK in the release.',
  },
  {
    name: 'Apple TV and phones',
    stage: 'Planned',
    ready: false,
    text: 'Through apps that already exist for these devices.',
  },
]

const steps = [
  {
    title: 'Save the install file',
    text: 'Into an empty folder, with PUID and PGID set to the user that owns the files.',
  },
  { title: 'Start it', text: 'docker compose up -d', code: true },
  {
    title: 'Create the owner account',
    text: 'Open http://<server>:8080/panel/. A setup wizard checks storage, network and sources; every step can be skipped.',
  },
  {
    title: 'Open it on the TV',
    text: 'Go to http://<server>:8080/ in the TV app or any browser and enter the code in the panel.',
  },
]
</script>

<template>
  <div class="ld">
    <section class="hero" :class="{ lit: heroLit }">
      <div class="hero-glow" aria-hidden="true" />
      <div class="ld-wrap hero-text">
        <LampMark v-model:lit="heroLit" class="hero-lamp" :size="100" />
        <p class="badge">
          <span class="dot" />
          <span>Open source under AGPL-3.0</span>
        </p>
        <h1>Your home cinema in <span class="glow">one container.</span></h1>
        <p class="hero-lead">
          Browse a catalog, start playback while the file downloads, keep what
          you watched in your own library, and let new episodes arrive on their
          own. Built for the TV first, running on your own hardware.
        </p>
        <div class="actions">
          <a
            class="ld-button primary"
            :href="withBase('/docs/install/docker-compose')"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M4 17l6-6-6-6" />
              <path d="M12 19h8" />
            </svg>
            <span>Install with Docker</span>
          </a>
          <a class="ld-button" :href="withBase('/demo/')" target="_self">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M9.04 9.69a.5.5 0 0 1 .65-.65l11 4.5a.5.5 0 0 1-.07.95l-4.35 1.04a1 1 0 0 0-.74.74l-1.04 4.35a.5.5 0 0 1-.95.07z"
              />
              <path d="M14 4.1 12 6M5.1 8l-2.9-.8M6 12l-1.9 2M7.2 2.2 8 5.1" />
            </svg>
            <span>Try the panel demo</span>
          </a>
          <a class="ld-button" :href="repoUrl">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
              />
            </svg>
            <span>Star on GitHub</span>
          </a>
        </div>
        <p class="hero-note">
          x86-64 and arm64 · mini PC, NAS or desktop · no cloud account
        </p>
      </div>
      <div class="ld-wrap hero-tv">
        <div class="ld-tv tv-glow">
          <div><TvHome /></div>
        </div>
        <div class="tv-stand" aria-hidden="true" />
        <p class="ld-caption">
          The showcase on a TV, with the remote or a pointer. Titles and artwork
          are made up for this page.
        </p>
      </div>
    </section>

    <section class="ld-section">
      <div class="ld-wrap">
        <p class="ld-eyebrow">
          One container instead of a stack
        </p>
        <h2 class="ld-h2">
          Stop wiring six apps together.
        </h2>
        <p class="ld-lead">
          A typical self-hosted media setup is a torrent client, a streaming
          server, a media server, two automation apps and a request manager,
          each with its own interface, database and settings. Torsher is one
          container and one database, set up in one panel.
        </p>
        <div class="diagram">
          <StackDiagram />
        </div>
        <p class="ld-caption">
          Only the indexer stays outside: connect any Torznab indexer, for
          example Prowlarr or Jackett.
        </p>
      </div>
    </section>

    <section id="features" class="ld-section">
      <div class="ld-wrap">
        <p class="ld-eyebrow">
          Watch, keep, follow
        </p>
        <h2 class="ld-h2">
          No separate modes for streaming and downloading.
        </h2>
        <div class="ld-grid ld-grid-3 cards">
          <article
            v-for="(feature, i) in features"
            :key="feature.title"
            class="ld-card feature"
          >
            <div class="feature-icon" aria-hidden="true">
              <svg
                v-if="i === 0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M7 4.5v15l12-7.5z" />
              </svg>
              <svg
                v-else-if="i === 1"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 3h12v18l-6-4-6 4z" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
              </svg>
            </div>
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.text }}</p>
            <div v-if="i === 0" class="widget">
              <div class="timeline" aria-hidden="true">
                <span class="buffered" />
                <span class="played" />
                <span class="thumb" />
              </div>
              <div class="times">
                <span>{{ playerTimes.position }}</span>
                <span><b>{{ playerTimes.remaining }}</b> ·
                  {{ playerTimes.endsAt }}</span>
              </div>
            </div>
            <div v-else-if="i === 2" class="widget episodes">
              <span class="season">{{ followSeason }}</span>
              <span
                v-for="episode in followEpisodes"
                :key="episode.code"
                class="episode"
              >
                <span class="code">{{ episode.code }}</span>
                <span :class="`tone-${episode.tone}`">{{ episode.state }}</span>
              </span>
            </div>
            <div v-else class="widget ld-mono paths">
              <span class="muted">/data/torrents/Lanterns of Vell (2026)/</span>
              <span class="accent">↳ hard link, no extra space</span>
              <span>/data/library/movies/Lanterns of Vell (2026) [tmdbid-…]/</span>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section id="showcase" class="ld-section">
      <div class="ld-wrap">
        <div class="split-head">
          <div>
            <p class="ld-eyebrow">
              The showcase
            </p>
            <h2 class="ld-h2">
              Made for the couch, not for an admin panel.
            </h2>
          </div>
          <p class="ld-lead side">
            Half of the product is the TV interface. It is built for a remote
            first and works just as well with a mouse in any browser.
          </p>
        </div>
        <div class="ld-tv player-frame">
          <div><TvPlayer /></div>
        </div>
        <div class="ld-grid ld-grid-4 facts">
          <div v-for="fact in facts" :key="fact.title" class="fact">
            <h3>{{ fact.title }}</h3>
            <p>{{ fact.text }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="ld-section">
      <div class="ld-wrap two-col">
        <div>
          <p class="ld-eyebrow">
            Audio and releases
          </p>
          <h2 class="ld-h2">
            Audio is a first-class citizen.
          </h2>
          <p class="ld-lead">
            Torsher reads release names the way you do: seasons, episode ranges,
            quality, source, and the type of every audio track. Set a preference
            once, and every pick follows it.
          </p>
          <ul class="checks">
            <li v-for="point in audioPoints" :key="point">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>{{ point }}</span>
            </li>
          </ul>
        </div>
        <div class="ld-card parse">
          <span class="parse-label">How a release name is read</span>
          <div class="ld-mono release">
            Quiet Harbor / Тихая гавань [S02E01-08 of 10] (2025) WEB-DL 1080p |
            MVO
          </div>
          <span class="parse-arrow">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 4v16M6 14l6 6 6-6" />
            </svg>
            Parsed
          </span>
          <dl class="parsed">
            <div v-for="row in parsed" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <section class="ld-section">
      <div class="ld-wrap two-col reverse">
        <div class="ld-card network">
          <div class="network-head">
            <span>{{ label("panel.settings.network.hosts.title") }}</span>
            <span class="check-all">{{
              label("panel.settings.network.hosts.checkAll")
            }}</span>
          </div>
          <div v-for="row in hosts" :key="row.host" class="route">
            <svg
              class="ok"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              :aria-label="label('panel.settings.network.status.ok')"
              role="img"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span class="host-cell">
              <span class="ld-mono host">{{ row.host }}</span>
              <span class="host-name">{{ row.name }}</span>
            </span>
            <span class="via">{{ row.via }}</span>
            <span class="ms">{{ row.ms }}</span>
          </div>
        </div>
        <div>
          <p class="ld-eyebrow">
            Network
          </p>
          <h2 class="ld-h2">
            Networking that sorts itself out.
          </h2>
          <p class="ld-lead">
            Every outgoing request follows a per-host route: direct or through
            your own SOCKS5 or HTTP proxy, with DNS over HTTPS built in. The
            panel checks every host from the server and shows what works.
          </p>
          <p class="ld-lead small">
            Catalog data and posters come through your server, so TVs don't
            fetch them from the internet themselves.
          </p>
        </div>
      </div>
    </section>

    <section id="platforms" class="ld-section">
      <div class="ld-wrap">
        <p class="ld-eyebrow">
          Everywhere you watch
        </p>
        <h2 class="ld-h2">
          One server, every screen.
        </h2>
        <div class="ld-grid ld-grid-4 cards">
          <div
            v-for="platform in platforms"
            :key="platform.name"
            class="ld-card platform"
          >
            <div class="platform-head">
              <span class="platform-name">{{ platform.name }}</span>
              <span class="chip" :class="{ ready: platform.ready }">{{
                platform.stage
              }}</span>
            </div>
            <p>{{ platform.text }}</p>
          </div>
        </div>
        <div class="server-line">
          <span class="server-title">The server</span>
          <span>Any machine with Docker: x86-64 Linux on a mini PC, a NAS or a
            desktop first; arm64 and Docker Desktop on macOS and Windows on a
            best-effort basis. Files play directly where the device can; the
            server converts the rest, on a GPU with VAAPI or NVENC, or on the
            CPU.</span>
        </div>
      </div>
    </section>

    <section id="install" class="ld-section">
      <div class="ld-wrap two-col top">
        <div>
          <p class="ld-eyebrow">
            Install
          </p>
          <h2 class="ld-h2">
            From a compose file to the couch.
          </h2>
          <ol class="steps">
            <li v-for="(step, i) in steps" :key="step.title">
              <span class="step-n">{{ i + 1 }}</span>
              <span class="step-body">
                <span class="step-title">{{ step.title }}</span>
                <span class="step-text" :class="{ 'ld-mono': step.code }">{{
                  step.text
                }}</span>
              </span>
            </li>
          </ol>
          <p class="install-note">
            Updating is <code>docker compose pull</code>. Before a new version
            changes the database, the server backs it up.
            <a :href="withBase('/docs/quick-start')">Quick start →</a>
            Want to look around first?
            <a :href="withBase('/demo/')" target="_self">Open the panel demo →</a>
          </p>
        </div>
        <ComposeSnippet />
      </div>
    </section>

    <section id="open-source" class="ld-section">
      <div class="ld-wrap">
        <p class="ld-eyebrow">
          Yours, all the way down
        </p>
        <h2 class="ld-h2">
          Your server, your sources, your data.
        </h2>
        <div class="ld-grid ld-grid-3 cards">
          <article class="ld-card value">
            <svg
              class="value-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 2v5M15 2v5" />
              <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
              <path d="M12 17v5" />
            </svg>
            <h3>Bring your own sources</h3>
            <p>
              Torsher ships with no sources and no content. Connect any Torznab
              indexer, for example Prowlarr or Jackett, or add a magnet link or
              a .torrent file by hand. You choose the sources and are
              responsible for using them legally.
            </p>
          </article>
          <article class="ld-card value">
            <svg
              class="value-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <h3>Private by default</h3>
            <p>
              The panel always asks for a password, TVs connect with a one-time
              code, saved keys are encrypted, and one port serves the showcase,
              the panel and the API. No telemetry and no cloud account.
            </p>
          </article>
          <article class="ld-card value">
            <svg
              class="value-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
            </svg>
            <h3>Open source, funded by donations</h3>
            <p>
              The code is AGPL-3.0, and bug reports are welcome. There are no
              paid features: Torsher lives on donations, which never depend on
              content.
            </p>
            <a class="value-link" :href="withBase('/donate')">Support Torsher →</a>
          </article>
        </div>
      </div>
    </section>

    <section ref="cta" class="cta" :class="{ lit: lampLit }">
      <div class="cta-glow" aria-hidden="true" />
      <div class="ld-wrap cta-inner">
        <LampMark v-model:lit="lampLit" class="cta-lamp" :size="132" />
        <h2>Switch it on.</h2>
        <p class="cta-lead">
          One compose file, a few minutes in the setup wizard, and the showcase
          is on your TV.
        </p>
        <code class="ld-mono cta-cmd"><span class="accent">$</span> docker compose up -d</code>
        <div class="actions">
          <a class="ld-button primary" :href="withBase('/docs/quick-start')">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M4 17l6-6-6-6" />
              <path d="M12 19h8" />
            </svg>
            <span>Get started</span>
          </a>
          <a class="ld-button" :href="repoUrl">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
              />
            </svg>
            <span>Star on GitHub</span>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
}

.hero-glow,
.cta-glow {
  position: absolute;
  left: 50%;
  width: 1200px;
  height: 960px;
  transform: translateX(-50%);
  background: radial-gradient(
    closest-side,
    rgba(255, 217, 138, 0.15),
    rgba(232, 184, 74, 0.05) 55%,
    rgba(232, 184, 74, 0) 100%
  );
  pointer-events: none;
}

.hero-glow {
  top: -260px;
}

/* The page light follows its lamp */
.hero-glow,
.cta-glow {
  opacity: 0;
  transition: opacity 0.9s ease-out;
}

.lit > .hero-glow,
.lit > .cta-glow {
  opacity: 1;
}

.hero-text {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding-top: clamp(48px, 7vw, 88px);
  text-align: center;
}

.hero-lamp {
  width: 100px;
  height: 90px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 14px;
  border: 1px solid rgba(232, 184, 74, 0.4);
  border-radius: 999px;
  background: rgba(232, 184, 74, 0.08);
  color: var(--ld-accent-text);
  font-size: 13px;
  font-weight: 500;
  text-wrap: balance;
}

.dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ld-accent);
}

h1 {
  max-width: 15ch;
  margin: 0;
  font-size: clamp(40px, 6.4vw, 88px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.035em;
}

.glow {
  color: var(--ld-accent-text);
}

.dark .glow {
  color: var(--ld-glow);
}

.hero-lead {
  max-width: 640px;
  margin: 0;
  color: var(--ld-muted);
  font-size: clamp(17px, 1.6vw, 20px);
  line-height: 1.55;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 6px;
}

.hero-note {
  margin: 0;
  color: var(--ld-muted);
  font-size: 14px;
}

.hero-tv {
  position: relative;
  margin-top: clamp(44px, 5vw, 60px);
}

.tv-glow {
  box-shadow:
    0 40px 140px rgba(232, 184, 74, 0),
    0 24px 60px rgba(0, 0, 0, 0.45);
  transition: box-shadow 0.9s ease-out;
}

.lit .tv-glow {
  box-shadow:
    0 40px 140px rgba(232, 184, 74, 0.13),
    0 24px 60px rgba(0, 0, 0, 0.45);
}

.tv-stand {
  width: 24%;
  height: clamp(8px, 1vw, 14px);
  margin: 0 auto;
  border: 1px solid var(--ld-line);
  border-top: 0;
  border-radius: 0 0 10px 10px;
  background: var(--color-surface);
}

.diagram {
  margin-top: 40px;
}

.cards {
  margin-top: 44px;
}

.feature {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px;
}

.feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(232, 184, 74, 0.12);
  color: var(--ld-accent-text);
}

.feature-icon svg {
  width: 22px;
  height: 22px;
}

.feature h3,
.value h3 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.feature p,
.value p,
.platform p {
  margin: 0;
  color: var(--ld-muted);
  font-size: 16px;
  line-height: 1.55;
}

.widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 18px;
  border: 1px solid var(--ld-line);
  border-radius: 14px;
  background: var(--ld-bg);
  font-size: 12.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.timeline {
  position: relative;
  height: 6px;
  margin: 6px 0 2px;
  border-radius: 3px;
  background: var(--ld-raised);
}

.timeline span {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 3px;
}

.timeline .buffered {
  width: 58%;
  background: var(--ld-line);
}

.dark .timeline .buffered {
  background: rgba(255, 255, 255, 0.42);
}

.timeline .played {
  width: 42%;
  background: var(--ld-accent);
}

.timeline .thumb {
  top: 50%;
  bottom: auto;
  left: 42%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: var(--ld-text);
}

.times {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--ld-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.times b {
  color: var(--ld-text);
  font-weight: 600;
}

.episodes {
  gap: 0;
  padding: 6px 0;
  font-size: 13px;
}

.season {
  padding: 4px 16px 8px;
  font-weight: 500;
}

.episode {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--ld-line);
}

.code {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.tone-muted {
  color: var(--ld-muted);
}

.tone-info {
  color: #2457b5;
}

.dark .tone-info {
  color: var(--color-info);
}

.tone-ok {
  color: #1d7a4a;
}

.dark .tone-ok {
  color: var(--color-ok);
}

.muted {
  color: var(--ld-muted);
}

.accent {
  color: var(--ld-accent-text);
}

.split-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px 48px;
}

.split-head > div {
  flex: 1 1 520px;
  min-width: 0;
}

.ld-lead.side {
  flex: 1 1 360px;
  max-width: 460px;
  margin: 0;
}

.player-frame {
  max-width: 1000px;
  margin: 40px auto 0;
}

.facts {
  gap: 28px 32px;
  margin-top: 32px;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 18px;
  border-top: 1px solid var(--ld-line);
}

.fact h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.fact p {
  margin: 0;
  color: var(--ld-muted);
  font-size: 15px;
  line-height: 1.55;
}

.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
  align-items: center;
  gap: 48px;
}

.two-col.top {
  align-items: start;
}

.two-col > * {
  min-width: 0;
}

@container ld (max-width: 940px) {
  .two-col.reverse > :first-child {
    order: 2;
  }
}

.checks {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 26px 0 0;
  padding: 0;
  font-size: 16px;
  line-height: 1.5;
  list-style: none;
}

.checks li {
  display: flex;
  gap: 12px;
}

.checks svg {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  color: var(--ld-accent-text);
}

.parse {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: clamp(20px, 3vw, 32px);
}

.parse-label {
  color: var(--ld-muted);
  font-size: 13px;
  font-weight: 500;
}

.release {
  padding: 16px 18px;
  border: 1px solid var(--ld-line);
  border-radius: 12px;
  background: var(--ld-bg);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.parse-arrow {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ld-accent-text);
  font-size: 13px;
}

.parse-arrow svg {
  width: 18px;
  height: 18px;
}

.parsed {
  margin: 0;
}

.parsed div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid var(--ld-line);
  font-size: 15px;
}

.parsed dt {
  color: var(--ld-muted);
}

.parsed dd {
  margin: 0;
  padding: 4px 12px;
  border-radius: 8px;
  background: var(--ld-raised);
  font-weight: 500;
  text-align: right;
}

.network {
  padding: clamp(20px, 3vw, 28px);
}

.network-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 17px;
  font-weight: 600;
}

.check-all {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--ld-line);
  border-radius: 9px;
  font-size: 14px;
  font-weight: 500;
}

.route {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto 56px;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--ld-line);
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.route:last-child {
  border-bottom: 0;
}

.ok {
  width: 16px;
  height: 16px;
  color: var(--color-ok);
}

:root:not(.dark) .ok {
  color: #1d7a4a;
}

.host-cell {
  display: grid;
  min-width: 0;
}

.host,
.host-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host {
  font-size: 13px;
  font-weight: 500;
}

.host-name {
  color: var(--ld-muted);
  font-size: 12.5px;
}

.via {
  color: var(--ld-muted);
  white-space: nowrap;
}

.ms {
  color: var(--ld-muted);
  font-size: 12.5px;
  text-align: right;
}

@container ld (max-width: 520px) {
  .route {
    grid-template-columns: 16px minmax(0, 1fr) 56px;
  }

  .via {
    grid-column: 2 / 4;
    grid-row: 2;
  }
}

.ld-lead.small {
  margin-top: 14px;
  font-size: 16px;
}

.platform {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px;
  border-radius: 16px;
}

.platform-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.platform-name {
  font-size: 17px;
  font-weight: 600;
}

.chip {
  flex: none;
  padding: 3px 10px;
  line-height: 18px;
  border-radius: 999px;
  background: var(--ld-raised);
  color: var(--ld-muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.chip.ready {
  background: rgba(232, 184, 74, 0.14);
  color: var(--ld-accent-text);
}

.platform p {
  font-size: 15px;
}

.server-line {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 28px;
  margin-top: 16px;
  padding: 22px;
  border: 1px dashed var(--ld-line);
  border-radius: 16px;
  color: var(--ld-muted);
  font-size: 15px;
  line-height: 1.55;
}

.server-line > span:last-child {
  flex: 1 1 520px;
}

.server-title {
  color: var(--ld-text);
  font-weight: 600;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 22px;
  margin: 30px 0 0;
  padding: 0;
  list-style: none;
}

.steps li {
  display: flex;
  gap: 16px;
}

.step-n {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(232, 184, 74, 0.5);
  border-radius: 50%;
  color: var(--ld-accent-text);
  font-size: 14px;
  font-weight: 600;
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
}

.step-title {
  font-size: 17px;
  font-weight: 600;
}

.step-text {
  color: var(--ld-muted);
  font-size: 15px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.step-text.ld-mono {
  color: var(--ld-text);
  font-size: 14px;
}

.install-note {
  margin: 28px 0 0;
  color: var(--ld-muted);
  font-size: 15px;
  line-height: 1.55;
}

.install-note code {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--ld-raised);
  color: var(--ld-text);
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
}

.install-note a,
.value-link {
  color: var(--ld-accent-text);
  font-weight: 500;
  text-decoration: none;
}

.value {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px;
}

.value h3 {
  font-size: 20px;
}

.value-icon {
  width: 26px;
  height: 26px;
  color: var(--ld-accent-text);
}

.value p {
  font-size: 15.5px;
  line-height: 1.6;
}

.value-link {
  margin-top: auto;
  font-size: 15px;
}

.cta {
  position: relative;
  padding: clamp(80px, 8vw, 112px) 0 clamp(56px, 6vw, 80px);
}

.cta-glow {
  top: 20px;
  width: 1000px;
  height: 760px;
}

.cta-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  max-width: 760px;
  text-align: center;
}

.cta-lamp {
  width: 132px;
  height: 118px;
}

.cta h2 {
  margin: 0;
  border: 0;
  padding: 0;
  font-size: clamp(40px, 5.4vw, 72px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.035em;
}

.cta-lead {
  max-width: 520px;
  margin: 0;
  color: var(--ld-muted);
  font-size: 18px;
  line-height: 1.6;
}

.cta-cmd {
  display: inline-flex;
  gap: 10px;
  padding: 10px 16px;
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  background: var(--ld-surface);
  font-size: 14px;
}
</style>
