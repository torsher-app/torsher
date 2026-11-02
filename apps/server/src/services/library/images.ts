import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
} from '../../db/schema.ts'
import { thumbUrl } from './thumbs.ts'

/** One request-local snapshot for all episodes; never mutate the shared metadata cache. */
export function localTitleImages(profileId: string, titleId: string) {
  const files = getDb()
    .select({
      id: mediaFiles.id,
      season: mediaFiles.season,
      episode: mediaFiles.episode,
      episodeTo: mediaFiles.episodeTo,
      thumb: mediaFiles.thumb,
    })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .where(
      and(
        eq(mediaFiles.titleId, titleId),
        eq(mediaFiles.state, 'present'),
        isNotNull(mediaFiles.thumb),
        eq(libraryFolders.status, 'ok'),
        sql`not exists (
          select 1 from ${libraryHiddenProfiles}
          where ${libraryHiddenProfiles.libraryId} = ${libraryFolders.libraryId}
            and ${libraryHiddenProfiles.profileId} = ${profileId}
        )`,
      ),
    )
    .orderBy(mediaFiles.season, mediaFiles.episode, desc(mediaFiles.addedAt))
    .all()

  return (
    season?: number | null,
    episode?: number | null,
    mediaFileId?: string | null,
  ) => {
    const file
      = (mediaFileId && files.find(file => file.id === mediaFileId))
        || files.find(
          file =>
            season == null
            || (file.season === season
              && episode != null
              && file.episode != null
              && episode >= file.episode
              && episode <= (file.episodeTo ?? file.episode)),
        )

    return file ? thumbUrl(file) : undefined
  }
}

export function localTitleImage(
  profileId: string,
  titleId: string,
  season?: number | null,
  episode?: number | null,
  mediaFileId?: string | null,
) {
  return localTitleImages(profileId, titleId)(season, episode, mediaFileId)
}
