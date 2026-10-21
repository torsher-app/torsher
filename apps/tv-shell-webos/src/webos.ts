interface PalmSystem {
  platformBack?: () => void
}

declare global {
  interface Window {
    PalmSystem?: PalmSystem
  }
}

/**
 * Выход по Back с первого экрана. На webOS 6+ система сама спрашивает
 * о выходе, на webOS 5 открывает Home. Вне webOS ничего не делает.
 */
export function exitApp() {
  const palm = window.PalmSystem
  if (palm?.platformBack)
    palm.platformBack()
  else if (palm)
    window.close()
}
