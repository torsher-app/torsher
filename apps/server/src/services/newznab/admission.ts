const admissions = new Map<string, Promise<unknown>>()

/** Serialize torrent and NZB grabs whose selected media can target the same title. */
export async function withDownloadAdmission<T>(
  titleId: string,
  task: () => T | Promise<T>,
): Promise<T> {
  const previous = admissions.get(titleId)
  const current = previous
    ? previous.catch(() => {}).then(task)
    : Promise.resolve().then(task)
  admissions.set(titleId, current)
  try {
    return await current
  }
  finally {
    if (admissions.get(titleId) === current)
      admissions.delete(titleId)
  }
}
