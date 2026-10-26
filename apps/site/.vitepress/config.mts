import type { HeadConfig } from 'vitepress'
import { defineConfig } from 'vitepress'
import server from '../../server/package.json' with { type: 'json' }
import { sidebar } from './sidebar.ts'

const siteUrl = 'https://torsher.app'
const siteTitle = 'Torsher'
const repoUrl = 'https://github.com/torsher-app/torsher'
const description
  = 'Self-hosted media center in one Docker container: a TV-first catalog, instant torrent streaming, your own library and series automation.'

function pagePath(relativePath: string) {
  if (relativePath === 'index.md')
    return '/'
  if (relativePath.endsWith('/index.md'))
    return `/${relativePath.slice(0, -'index.md'.length)}`
  return `/${relativePath.replace(/\.md$/, '')}`
}

const ogImage = `${siteUrl}/og-image.png`

// GA4 counts client-side route changes itself through enhanced measurement (browser history events)
const gaMeasurementId = 'G-HF50VGGL41'

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

  sitemap: {
    hostname: siteUrl,
    transformItems: items => items.filter(item => !item.url.endsWith('404')),
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#0b0d12' }],
    ['script', { async: '', src: `https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}` }],
    ['script', {}, `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaMeasurementId}');`],
  ],

  // The built 404 page uses fixed page data and never reaches transformPageData
  transformHead({ pageData }) {
    if (pageData.isNotFound)
      return [['meta', { name: 'robots', content: 'noindex, nofollow' }]]
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
