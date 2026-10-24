import type { HeadConfig } from 'vitepress'
import { defineConfig } from 'vitepress'
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

function seoHead(relativePath: string, title: string, pageDescription: string): HeadConfig[] {
  const url = new URL(pagePath(relativePath), siteUrl).toString()

  return [
    ['link', { rel: 'canonical', href: url }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: siteTitle }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: pageDescription }],
    ['meta', { property: 'og:url', content: url }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: title }],
    ['meta', { name: 'twitter:description', content: pageDescription }],
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
  ],

  transformPageData(pageData) {
    if (pageData.isNotFound) {
      pageData.frontmatter.head = [['meta', { name: 'robots', content: 'noindex, nofollow' }]]
      return
    }

    const title = pageData.relativePath === 'index.md'
      ? siteTitle
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
      message: `Released under the <a href="${repoUrl}/blob/main/LICENSE">AGPL-3.0 license</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.`,
      copyright: '© 2026-present <a href="https://github.com/antonreshetov">Anton Reshetov</a>',
    },
  },
})
