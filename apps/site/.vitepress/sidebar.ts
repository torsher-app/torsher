import type { DefaultTheme } from 'vitepress'

/**
 * Documentation navigation. `scripts/check.ts` fails when a page under
 * `docs/` is missing here, so a new page is always reachable.
 */
export const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'What is Torsher', link: '/docs/' },
      { text: 'Quick start', link: '/docs/quick-start' },
    ],
  },
  {
    text: 'Install',
    items: [
      { text: 'Requirements', link: '/docs/install/requirements' },
      { text: 'Docker Compose', link: '/docs/install/docker-compose' },
      {
        text: 'Hardware transcoding',
        link: '/docs/install/hardware-acceleration',
      },
      { text: 'Configuration', link: '/docs/install/configuration' },
      { text: 'Mini PC', link: '/docs/install/mini-pc' },
      { text: 'NAS', link: '/docs/install/nas' },
      { text: 'Docker Desktop', link: '/docs/install/docker-desktop' },
      { text: 'Remote access', link: '/docs/install/remote-access' },
    ],
  },
  {
    text: 'First run',
    items: [
      { text: 'Setup wizard', link: '/docs/setup/wizard' },
      { text: 'Indexers', link: '/docs/setup/indexers' },
      { text: 'TMDB key', link: '/docs/setup/tmdb' },
      { text: 'Network', link: '/docs/setup/network' },
      { text: 'Storage', link: '/docs/setup/storage' },
    ],
  },
  {
    text: 'TV',
    items: [
      { text: 'LG webOS', link: '/docs/tv/lg-webos' },
      { text: 'Connect a device', link: '/docs/tv/connect' },
      { text: 'Browser', link: '/docs/tv/browser' },
      { text: 'Other devices', link: '/docs/tv/other-devices' },
    ],
  },
  {
    text: 'Watching',
    collapsed: true,
    items: [
      { text: 'Showcase and remote', link: '/docs/watch/showcase' },
      { text: 'Sources and voice-overs', link: '/docs/watch/sources' },
      { text: 'Player', link: '/docs/watch/player' },
      { text: 'Download and keep', link: '/docs/watch/download-keep' },
      { text: 'Library and home videos', link: '/docs/watch/library' },
      { text: 'Mine', link: '/docs/watch/mine' },
      { text: 'Profiles and PIN', link: '/docs/watch/profiles' },
      { text: 'Follow', link: '/docs/watch/follow' },
    ],
  },
  {
    text: 'Control panel',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/docs/panel/overview' },
      { text: 'Downloads', link: '/docs/panel/downloads' },
      { text: 'Sources', link: '/docs/panel/sources' },
      { text: 'Library', link: '/docs/panel/library' },
      { text: 'Collections', link: '/docs/panel/collections' },
      { text: 'Profiles and devices', link: '/docs/panel/profiles-devices' },
      { text: 'Logs', link: '/docs/panel/logs' },
      { text: 'Settings', link: '/docs/panel/settings' },
    ],
  },
  {
    text: 'Maintenance',
    collapsed: true,
    items: [
      { text: 'Update and roll back', link: '/docs/maintain/update' },
      { text: 'Backup and move', link: '/docs/maintain/backup' },
      { text: 'Reset the password', link: '/docs/maintain/reset-password' },
      { text: 'Logs and diagnostics', link: '/docs/maintain/logs' },
    ],
  },
  {
    text: 'Help',
    items: [
      { text: 'Troubleshooting', link: '/docs/troubleshooting' },
      { text: 'FAQ', link: '/docs/faq' },
      { text: 'Legal and attribution', link: '/docs/legal' },
    ],
  },
]
