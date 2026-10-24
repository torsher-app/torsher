interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Measured {
  getBoundingClientRect: () => Box
  textContent: string | null
  querySelector: (selector: string) => Measured | null
}

interface Root {
  querySelector: (selector: string) => Measured | null
  querySelectorAll: (selector: string) => ArrayLike<Measured>
}

export interface AxisOffset {
  name: string
  // Сдвиг центра знака от центра круга, пиксели макета: + — правее и ниже
  dx: number
  dy: number
  // Сдвиг круга от оси рейла (центра круга первого пункта)
  column: number
}

// Субпиксельное округление вёрстки — не сдвиг
export const AXIS_TOLERANCE = 0.25

function center(box: Box) {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

// Круг — левый край пункта: в свёрнутом рейле весь пункт, в раскрытом —
// скругление плашки. Поэтому центр — половина меньшей стороны от левого края
function circleCenter(box: Box) {
  const radius = Math.min(box.width, box.height) / 2

  return { x: box.left + radius, y: box.top + box.height / 2 }
}

/**
 * Насколько иконки, аватар и знак рейла отстоят от центров своих кругов.
 * У знака своего круга нет: он сравнивается с осью первого пункта, а по
 * вертикали — со своей строкой. `unit` — пиксель макета (`innerWidth / 1920`)
 */
export function railAxisOffsets(rail: Root, unit: number): AxisOffset[] {
  const offsets: AxisOffset[] = []
  const items = Array.from(rail.querySelectorAll('.rail__item'))
  const first = items[0]

  if (!first)
    return offsets

  const axis = circleCenter(first.getBoundingClientRect()).x
  const round = (px: number) => Math.round((px / unit) * 100) / 100

  const brand = rail.querySelector('.rail__brand')
  const brandMark = brand?.querySelector('.icon')

  if (brand && brandMark) {
    const mark = center(brandMark.getBoundingClientRect())

    offsets.push({
      name: 'brand',
      dx: round(mark.x - axis),
      dy: round(mark.y - center(brand.getBoundingClientRect()).y),
      column: 0,
    })
  }

  for (const item of items) {
    const mark = item.querySelector('.rail__avatar, .icon')

    if (!mark)
      continue

    const circle = circleCenter(item.getBoundingClientRect())
    const markCenter = center(mark.getBoundingClientRect())

    offsets.push({
      name: item.textContent?.trim() ?? '',
      dx: round(markCenter.x - circle.x),
      dy: round(markCenter.y - circle.y),
      column: round(circle.x - axis),
    })
  }

  return offsets
}

export function misaligned(offsets: AxisOffset[]) {
  return offsets.filter(
    offset =>
      Math.abs(offset.dx) > AXIS_TOLERANCE
      || Math.abs(offset.dy) > AXIS_TOLERANCE
      || Math.abs(offset.column) > AXIS_TOLERANCE,
  )
}
