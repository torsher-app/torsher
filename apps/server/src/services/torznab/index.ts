export type {
  TorznabCaps,
  TorznabCategory,
  TorznabSearchMode,
} from './caps.ts'
export { parseCaps } from './caps.ts'
export type { DownloadedTorrent, SourceErrorKind } from './client.ts'
export {
  downloadTorrent,
  fetchCaps,
  normalizeTorznabUrl,
  readBody,
  readTorznabXml,
  SourceError,
  sourceGet,
  TORRENT_FILE_MAX_BYTES,
  torznabRequestUrl,
} from './client.ts'
export type {
  SearchIds,
  SearchParams,
  SearchQuery,
  TorznabRelease,
} from './search.ts'
export {
  buildSearchRequests,
  MOVIE_CATEGORY,
  parseSearchResults,
  searchIndexer,
  TV_CATEGORY,
} from './search.ts'
export { child, children, parseXml, text } from './xml.ts'
