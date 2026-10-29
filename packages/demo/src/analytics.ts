declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * Экран демо в статистике сайта. Экраны живут в hash-адресах, поэтому шлём
 * своё событие с шаблоном маршрута (`/title/:id`), а не полный адрес.
 * Счётчик сайт грузит только на боевом домене, в разработке вызов пустой
 */
export function trackScreen(demo: 'panel' | 'tv', screen: string) {
  window.gtag?.('event', 'demo_screen', { demo, screen })
}
