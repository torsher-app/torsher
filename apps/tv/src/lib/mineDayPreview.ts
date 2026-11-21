/** Reserve the overflow caption only when the complete day does not fit. */
export function dayPreviewRows(
  total: number,
  height: number,
  rowHeight: number,
  moreHeight: number,
) {
  if (rowHeight <= 0 || height <= 0)
    return 0

  const capacity = Math.floor(height / rowHeight)
  return total <= capacity
    ? total
    : Math.max(0, Math.floor((height - moreHeight) / rowHeight))
}
