import type { HeadConfig } from 'vitepress'
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitepress'
import server from '../../server/package.json' with { type: 'json' }
import { sidebar } from './sidebar.ts'

const siteUrl = 'https://torsher.app'
const siteTitle = 'Torsher'
const repoUrl = 'https://github.com/torsher-app/torsher'
const description
  = 'Self-hosted media center in one Docker container: a TV showcase with a catalog, your own library, playback while the file downloads and series automation.'

function pagePath(relativePath: string) {
  if (relativePath === 'index.md')
    return '/'
  if (relativePath.endsWith('/index.md'))
    return `/${relativePath.slice(0, -'index.md'.length)}`
  return `/${relativePath.replace(/\.md$/, '')}`
}

// The panel and showcase demos are the real apps built with in-browser mocks
// (`build:demo` of @torsher/web and @torsher/tv); the site build ships them as
// static files under /demo/ and /demo/tv/
const demoBuilds = [
  { from: join(import.meta.dirname, '../../web/.output-demo/public'), to: 'demo', pkg: '@torsher/web' },
  { from: join(import.meta.dirname, '../../tv/dist-demo'), to: 'demo/tv', pkg: '@torsher/tv' },
]

const ogImage = `${siteUrl}/og-image.png`

const siteStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', 'name': siteTitle, 'url': `${siteUrl}/` },
    {
      '@type': 'Organization',
      'name': siteTitle,
      'url': `${siteUrl}/`,
      'logo': `${siteUrl}/logo.svg`,
      'sameAs': [repoUrl],
    },
  ],
}

// GA4 counts client-side route changes itself through enhanced measurement (browser history events).
// The tag loads only on the production host, so dev servers and local previews stay out of the stats
const gaMeasurementId = 'G-HF50VGGL41'
const gaScript = `if(location.hostname==='torsher.app'){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${gaMeasurementId}')}`

function seoHead(relativePath: string, title: string, pageDescription: string): HeadConfig[] {
  const url = new URL(pagePath(relativePath), siteUrl).toString()

  return [
    ['link', { rel: 'canonical', href: url }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: siteTitle }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: pageDescription }],
    ['meta', { property: 'og:url', content: url }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'Torsher: your home cinema in one container' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: title }],
    ['meta', { name: 'twitter:description', content: pageDescription }],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ]
}

export default defineConfig({
  title: siteTitle,
  description,
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // The product UI is dark; the site opens the same way and keeps a light theme
  appearance: 'dark',

  // /demo/ and /demo/tv/ are the demos copied in at buildEnd, not VitePress pages
  ignoreDeadLinks: [/^\/demo\//],

  buildEnd({ outDir }) {
    for (const demo of demoBuilds) {
      if (!existsSync(demo.from))
        throw new Error(`Demo not found at ${demo.from}: run \`pnpm --filter ${demo.pkg} build:demo\` first`)

      cpSync(demo.from, join(outDir, demo.to), { recursive: true })
    }
  },

  sitemap: {
    hostname: siteUrl,
    // The demos are copied in after the pages, so the sitemap lists them by hand
    transformItems: items => [
      ...items.filter(item => !item.url.endsWith('404')),
      ...demoBuilds.map(demo => ({ url: `${demo.to}/` })),
    ],
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#0b0d12' }],
    ['script', {}, gaScript],
  ],

  // The built 404 page uses fixed page data and never reaches transformPageData
  transformHead({ pageData }) {
    if (pageData.isNotFound)
      return [['meta', { name: 'robots', content: 'noindex, nofollow' }]]

    // Search engines read the site name and logo from the home page only
    if (pageData.relativePath === 'index.md')
      return [['script', { type: 'application/ld+json' }, JSON.stringify(siteStructuredData)]]
  },

  transformPageData(pageData) {
    // The home page sets its full title with `titleTemplate: false`
    const title = pageData.relativePath === 'index.md'
      ? pageData.title
      : `${pageData.title} | ${siteTitle}`
    const head = seoHead(pageData.relativePath, title, pageData.description || description)

    // Page head is included in both rendered HTML and client-side navigation
    pageData.frontmatter.head = [...(pageData.frontmatter.head || []), ...head]
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Docs', link: '/docs/', activeMatch: '^/docs/' },
      { text: 'Install', link: '/docs/install/docker-compose' },
      { text: 'Donate', link: '/donate' },
      {
        // The product version is the server package version, the same one the release tag must match
        text: server.version,
        items: [
          { text: 'Update', link: '/docs/maintain/update' },
          { text: 'Changelog', link: `${repoUrl}/releases` },
        ],
      },
    ],

    sidebar: { '/docs/': sidebar },

    socialLinks: [{ icon: 'github', link: repoUrl }],

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    editLink: {
      pattern: `${repoUrl}/edit/main/apps/site/:path`,
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: `Released under the <a href="${repoUrl}/blob/main/LICENSE">AGPL-3.0 license</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.<br>Torsher includes no content: you choose your sources and are responsible for them. <a href="/privacy">Privacy Policy</a>`,
      copyright: '© 2026-present <a href="https://github.com/antonreshetov">Anton Reshetov</a>',
    },
  },
})
