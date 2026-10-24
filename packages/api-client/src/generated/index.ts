/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export interface AboutResponseInput {
  version: string;
  commit?: string;
  license: string;
  /** @format uri */
  sourceUrl: string;
  imdbAttribution: boolean;
}

export interface SignupInput {
  /** @minLength 2 */
  name: string;
  /**
   * @format email
   * @pattern ^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$
   */
  email: string;
  /** @minLength 8 */
  password: string;
}

export interface SetupResponseInput {
  needsSetup: boolean;
}

export interface SigninInput {
  /**
   * @format email
   * @pattern ^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$
   */
  email: string;
  password: string;
}

export interface MessageResponseInput {
  message: string;
}

export interface TitleRatingInput {
  provider: string;
  label: string;
  value: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  votes?: number;
}

export interface PosterRatingInput {
  source: "tmdb" | "imdb";
  value: number;
}

export interface CardInput {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings?: TitleRatingInput[];
  posterRatings?: PosterRatingInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
}

export interface TitleSeasonInput {
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  number: number;
  name: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  episodeCount: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  airedEpisodeCount: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
}

export interface TitleDetailsInput {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings: TitleRatingInput[];
  posterRatings?: PosterRatingInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
  overview: string;
  genres: string[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  runtime?: number;
  backdrop?: string;
  logo?: string;
  ongoing?: boolean;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  endYear?: number;
  certification?: string;
  countries: string[];
  studios: string[];
  creators: string[];
  seasons?: TitleSeasonInput[];
}

export interface EpisodeInput {
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  number: number;
  title: string;
  overview: string;
  airDate?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  runtime?: number;
  still?: string;
}

export interface SeasonDetailsInput {
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  number: number;
  name: string;
  episodes: EpisodeInput[];
}

export interface PersonInput {
  id: string;
  name: string;
  role?: string;
  photo?: string;
}

export interface CrewMemberInput {
  id: string;
  name: string;
  photo?: string;
  jobs: ("director" | "creator" | "writer" | "camera" | "music" | "producer")[];
}

export interface CatalogTagInput {
  id: string;
  name: string;
}

export interface TitleExtrasInput {
  cast: PersonInput[];
  crew: CrewMemberInput[];
  similar: CardInput[];
  aka: string[];
  directors: string[];
  tags: {
    genres: CatalogTagInput[];
    studios: CatalogTagInput[];
    keywords: CatalogTagInput[];
  };
}

export interface CatalogSearchResponseInput {
  items: CardInput[];
  people: PersonInput[];
}

export interface CatalogTrendingResponseInput {
  items: CardInput[];
}

export interface CatalogDiscoverResponseInput {
  items: CardInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  page: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  totalPages: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface CatalogGenresResponseInput {
  items: CatalogTagInput[];
}

export interface BackdropInput {
  id: string;
  title: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  backdrop: string;
}

export interface CatalogBackdropsResponseInput {
  items: BackdropInput[];
}

export interface PersonCreditInput {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings?: TitleRatingInput[];
  posterRatings?: PosterRatingInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
  detail?: string;
  watched: boolean;
}

export interface PersonDetailsInput {
  id: string;
  name: string;
  photo?: string;
  knownFor?:
    | "acting"
    | "directing"
    | "creator"
    | "writing"
    | "production"
    | "camera"
    | "music"
    | "editing";
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  biography: string;
  credits: {
    role:
      | "acting"
      | "directing"
      | "creator"
      | "writing"
      | "production"
      | "camera"
      | "music"
      | "editing";
    items: PersonCreditInput[];
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    total: number;
  }[];
}

export interface SourceErrorResponseInput {
  message: string;
  kind:
    | "auth"
    | "timeout"
    | "unreachable"
    | "bad_response"
    | "remote"
    | "unsupported";
}

export interface IndexerInput {
  id: string;
  name: string;
  url: string;
  hasApiKey: boolean;
  enabled: boolean;
  managerId: string | null;
  managerKind: "prowlarr" | "jackett" | null;
  missing: boolean;
  categories: {
    id: number;
    name: string;
  }[];
  searchModes: {
    search: boolean;
    tvSearch: boolean;
    movieSearch: boolean;
  } | null;
  checkStatus:
    | "ok"
    | "auth"
    | "timeout"
    | "unreachable"
    | "bad_response"
    | "remote"
    | null;
  checkedAt: string | null;
}

export interface IndexerListInput {
  items: IndexerInput[];
}

export interface CreateIndexerInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name: string;
  /**
   * @format uri
   * @maxLength 2000
   */
  url: string;
  /**
   * @minLength 1
   * @maxLength 500
   */
  apiKey?: string;
}

export interface UpdateIndexerInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name?: string;
  enabled?: boolean;
  /**
   * @minLength 1
   * @maxLength 500
   */
  apiKey?: string;
}

export interface IndexerManagerInput {
  id: string;
  kind: "prowlarr" | "jackett";
  url: string;
  syncedAt: string | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  indexerCount: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  missingCount: number;
}

export interface IndexerManagerListInput {
  items: IndexerManagerInput[];
}

export interface CreateIndexerManagerInput {
  kind: "prowlarr" | "jackett";
  /**
   * @format uri
   * @maxLength 2000
   */
  url: string;
  /**
   * @minLength 1
   * @maxLength 500
   */
  apiKey: string;
}

export interface IndexerManagerSyncResultInput {
  manager: IndexerManagerInput;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  added: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  updated: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  missing: number;
}

export interface VideoResolutionInput {
  value: "2160p" | "1080p" | "720p" | "SD";
  basis: "probe" | "file" | "title" | "source" | "codec";
  sure: boolean;
}

export interface VoiceRefInput {
  studio?: string;
  type?: "D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original";
}

export interface AudioTrackInput {
  type?: "D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original";
  studio?: string;
  language?: string;
}

export interface SourceCandidateInput {
  id: string;
  title: string;
  indexers: string[];
  size: number | null;
  episodeSize: number | null;
  seeders: number;
  peers: number | null;
  quality:
    | "2160p"
    | "1440p"
    | "1080p"
    | "1080i"
    | "720p"
    | "576p"
    | "480p"
    | "360p"
    | null;
  resolution: VideoResolutionInput | null;
  source: string | null;
  codec: string | null;
  hdr: string[];
  audio: AudioTrackInput[];
  channels: "2.0" | "5.1" | "7.1" | null;
  subs: string[];
  voice: AudioTrackInput | null;
  voiceKeys: string[];
  seasons: number[];
  episodes: {
    from: number;
    to: number;
    total?: number;
  } | null;
  isPack: boolean;
  confidence: "high" | "medium";
  pickReason:
    | "pinnedVoice"
    | "profile"
    | "bestQuality"
    | "smaller"
    | "moreSeeders"
    | "originalAudio"
    | null;
  publishedAt: string | null;
  lastWatched: boolean;
}

export interface VoiceOptionInput {
  key: string;
  studio?: string;
  type?: "D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original";
  maxQuality?: "2160p" | "1080p" | "720p" | "SD";
  seeders: number;
  count: number;
  pinned: boolean;
}

export interface TitleSourcesInput {
  season: number | null;
  episode: number | null;
  updatedAt: string;
  profile: {
    qualities: ("2160p" | "1080p" | "720p" | "SD")[];
    voiceTypes: ("D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original")[];
  };
  pinnedVoice: VoiceRefInput | null;
  seasonCandidate: string | null;
  top: string[];
  candidates: SourceCandidateInput[];
  voices: VoiceOptionInput[];
  query: {
    current: string | null;
    suggestions: string[];
  };
  indexers: {
    total: number;
    failed: {
      name: string;
      kind:
        | "auth"
        | "timeout"
        | "unreachable"
        | "bad_response"
        | "remote"
        | "unsupported";
    }[];
  };
}

export interface PinTitleVoiceInput {
  /**
   * @min 0
   * @max 999
   */
  season: number;
  voice: VoiceRefInput | null;
}

export interface WatchTitleInput {
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @min 1
   * @max 9999
   */
  episode?: number;
  /**
   * @minLength 1
   * @maxLength 64
   */
  candidateId?: string;
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
}

export interface TitleWatchInput {
  status: "ready" | "resolving";
  torrentId: string;
  fileIndex: number | null;
  candidateId: string;
}

export interface WatchErrorResponseInput {
  message: string;
  kind: "no_sources" | "not_playable" | "candidate_gone";
}

export interface OpenTitleInput {
  /**
   * @minLength 1
   * @maxLength 64
   */
  candidateId: string;
  /**
   * @minLength 1
   * @maxLength 200
   */
  query?: string;
}

export interface TitleOpenInput {
  status: "ready" | "resolving";
  torrentId: string;
}

export interface FileDownloadInput {
  state: "downloading" | "downloaded" | "library";
  progress: number;
}

export interface TitleFileInput {
  fileIndex: number;
  name: string;
  size: number;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number | null;
  watched: boolean;
  download: FileDownloadInput | null;
}

export interface DownloadTitleInput {
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @minLength 1
   * @maxLength 64
   */
  candidateId?: string;
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
  /**
   * @maxItems 10000
   * @minItems 1
   */
  files?: number[];
}

export interface TitleDownloadStartInput {
  status: "started" | "resolving";
  torrentId: string;
  candidateId: string;
  files: number;
  bytes: number;
}

export interface LibraryFileInput {
  id: string;
  season: number | null;
  episode: number | null;
  episodeTo: number | null;
  quality: string | null;
  size: number;
  duration: number | null;
}

export interface TitleLibraryInput {
  files: LibraryFileInput[];
}

export interface TitleDownloadInput {
  state: "downloading" | "downloaded" | "library" | null;
  progress: number;
  canKeep: boolean;
  release: {
    quality: string | null;
    voice: VoiceRefInput | null;
  } | null;
  peers: {
    connected: number;
    found: number;
  };
  speed: number;
  stalled: boolean;
  downloads: {
    torrentId: string;
    phase: "downloading" | "placing" | "unmatched";
    seasons: number[];
    progress: number;
    release: {
      quality: string | null;
      voice: VoiceRefInput | null;
    } | null;
    peers: {
      connected: number;
      found: number;
    };
    speed: number;
    stalled: boolean;
  }[];
}

export interface TitleFilesInput {
  status: "ready" | "resolving";
  name: string;
  files: TitleFileInput[];
}

export interface MarkWatchedInput {
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @min 1
   * @max 9999
   */
  episode?: number;
  watched: boolean;
}

export interface EpisodeProgressInput {
  season: number;
  episode: number;
  position: number;
  duration: number | null;
  watched: boolean;
}

export interface SeasonReleaseInput {
  season: number;
  torrentId: string;
  quality: "2160p" | "1080p" | "720p" | "SD" | null;
  voice: VoiceRefInput | null;
  episodes: number[];
}

export interface EpisodeFileInput {
  torrentId: string;
  fileIndex: number;
}

export interface ResumeTargetInput {
  season: number | null;
  episode: number | null;
  position: number;
  duration: number | null;
  next: boolean;
  file: EpisodeFileInput | null;
}

export interface TitleProgressInput {
  resume: ResumeTargetInput | null;
  last: {
    season: number | null;
    episode: number | null;
    position: number;
    duration: number | null;
    watched: boolean;
    updatedAt: string;
  } | null;
  seasonReleases: SeasonReleaseInput[];
  episodes: EpisodeProgressInput[];
}

export interface UpNextInput {
  next: {
    season: number;
    episode: number;
    title: string;
    still?: string;
    file: EpisodeFileInput | null;
  } | null;
}

export interface PlaybackTitleInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  id: string;
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @min 1
   * @max 9999
   */
  episode?: number;
}

export interface EpisodeCardInput {
  titleId: string;
  title: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  season: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  episode: number;
  episodeTitle?: string;
  image?: string;
  airDate?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  newCount: number;
}

export interface CatalogRowInput {
  id:
    | "trending"
    | "trendingMovies"
    | "trendingSeries"
    | "popularMovies"
    | "popularSeries"
    | "russianSeries"
    | "nowPlaying"
    | "onTheAir"
    | "topRatedMovies"
    | "topRatedSeries"
    | "themeSpace"
    | "themeZombies"
    | "themeVampires"
    | "themeDetectives"
    | "themeSpies"
    | "themeDisasters"
    | "themeWar"
    | "themeWesterns"
    | "newEpisodes"
    | "watchlist"
    | "collection"
    | "library"
    | "libraryRecent"
    | "libraryMovies"
    | "librarySeries"
    | "libraryUnmatched"
    | "libraryHomeVideo"
    | "libraryUntitled";
  kind: "top10" | "posters" | "episodes";
  title: string;
  ref?: string;
  name?: string;
  items: CardInput[];
  episodes?: EpisodeCardInput[];
}

export interface ReleaseCardInput {
  torrentId: string;
  name: string;
  matchStatus: "unsure" | "unmatched";
  suggestion: CardInput | null;
  image?: string;
  query: string;
  seasons: number[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  videos: number;
  size: number;
}

export interface ReleasesRowInput {
  id: "libraryUnmatched";
  kind: "releases";
  title: string;
  items: ReleaseCardInput[];
}

export interface FileCardInput {
  id: string;
  name: string;
  album: string | null;
  capturedAt: string | null;
  duration: number | null;
  share: number;
  thumb: string;
}

export interface FilesRowInput {
  id: "libraryHomeVideo" | "libraryUntitled";
  kind: "files";
  title: string;
  items: FileCardInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface HomeAlbumInput {
  libraryId: string;
  album: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count: number;
  from: string | null;
  to: string | null;
  coverId: string;
}

export interface HomeVideoSectionInput {
  albums: HomeAlbumInput[];
}

export interface HomeVideoListInput {
  items: FileCardInput[];
}

export interface ContinueCardInput {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings?: TitleRatingInput[];
  posterRatings?: PosterRatingInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
  image?: string;
  season: number | null;
  episode: number | null;
  episodeTitle?: string;
  position: number;
  duration: number | null;
  next: boolean;
  file: EpisodeFileInput | null;
}

export interface ContinueRowInput {
  id: "continue";
  kind: "continue";
  title: string;
  items: ContinueCardInput[];
}

export type HomeRowInput =
  ContinueRowInput | ReleasesRowInput | FilesRowInput | CatalogRowInput;

export interface HomeResponseInput {
  rows: HomeRowInput[];
}

export interface CollectionInput {
  id: string;
  name: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count: number;
  showOnHome: boolean;
  hiddenFrom: string[];
}

export interface CollectionListInput {
  items: CollectionInput[];
}

export interface CreateCollectionInput {
  /**
   * @minLength 1
   * @maxLength 60
   */
  name: string;
  showOnHome?: boolean;
  /** @maxItems 100 */
  hiddenFrom?: string[];
}

export interface UpdateCollectionInput {
  /**
   * @minLength 1
   * @maxLength 60
   */
  name?: string;
  showOnHome?: boolean;
  /** @maxItems 100 */
  hiddenFrom?: string[];
}

export interface CollectionTitlesInput {
  items: CardInput[];
}

export interface CollectionErrorResponseInput {
  message: string;
  kind: "duplicate";
}

export interface StartPairingInput {
  type?: "tv" | "browser" | "other";
}

export interface PairingInput {
  secret: string;
  code: string;
  expiresAt: string;
}

export interface PairingStatusInput {
  status: "pending" | "approved" | "expired";
  expiresAt: string;
  device: {
    id: string;
    name: string;
  } | null;
}

export interface ConfirmPairingInput {
  /**
   * @minLength 1
   * @maxLength 20
   */
  code: string;
  /**
   * @minLength 1
   * @maxLength 60
   */
  name: string;
}

export interface ConfirmedPairingInput {
  name: string;
  type: "tv" | "browser" | "other";
}

export interface PairingErrorResponseInput {
  message: string;
  kind: "invalid" | "expired";
}

export interface DeviceInput {
  id: string;
  name: string;
  type: "tv" | "browser" | "other";
  profile: {
    id: string;
    name: string;
    color:
      | "violet"
      | "green"
      | "orange"
      | "blue"
      | "rose"
      | "teal"
      | "amber"
      | "slate";
  } | null;
  address: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  watching: boolean;
}

export interface DeviceListInput {
  items: DeviceInput[];
}

export interface UpdateDeviceInput {
  /**
   * @minLength 1
   * @maxLength 60
   */
  name: string;
}

export interface EngineUnavailableResponseInput {
  message: string;
  kind: "not_installed" | "starting" | "stopped";
}

export interface TorrentFileInput {
  index: number;
  path: string;
  size: number;
  isVideo: boolean;
  downloaded: number;
  selected: boolean;
  inLibrary: boolean;
}

export interface TorrentInput {
  id: string;
  infoHash: string;
  name: string;
  source: "magnet" | "file";
  status: "resolving" | "ready" | "failed";
  error: "timeout" | "rejected" | "failed" | null;
  files: TorrentFileInput[];
  totalSize: number;
  addedAt: string;
  lastAccessAt: string | null;
  titleId: string | null;
  matchStatus: "matched" | "unsure" | "unmatched" | "ignored" | "user" | null;
  matchSuggestion: string | null;
  retention: "cache" | "keep";
  inLibrary: boolean;
  pauseReason: "user" | "storage" | null;
  state:
    | "idle"
    | "partial"
    | "downloading"
    | "stalled"
    | "seeding"
    | "complete"
    | "paused";
  streaming: boolean;
  progress: {
    downloaded: number;
    wanted: number;
  };
  sizeOnDisk: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: {
    connected: number;
    found: number;
  };
}

export interface TorrentListInput {
  items: TorrentInput[];
  engine: "ready" | "not_installed" | "starting" | "stopped";
  totals: {
    downloadSpeed: number;
    uploadSpeed: number;
  };
  cache: {
    used: number;
    limit: number;
  };
}

export interface DownloadTorrentInput {
  /**
   * @maxItems 10000
   * @minItems 1
   */
  files: number[];
}

export interface UpdateTorrentTitleInput {
  /** @pattern ^tmdb:(?:movie|tv):\d{1,10}$ */
  titleId: string | null;
}

export interface UpdateRetentionInput {
  retention: "cache" | "keep";
}

export interface CreateTorrentInput {
  /**
   * @maxLength 20000
   * @pattern ^magnet:\?
   */
  magnet?: string;
  /**
   * @format base64
   * @maxLength 11184812
   * @pattern ^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$
   */
  torrentFile?: string;
}

export interface TorrentStatsInput {
  activity: "idle" | "downloading";
  peers: {
    connected: number;
    found: number;
  };
  downloadSpeed: number;
  uploadSpeed: number;
  file: {
    size: number;
    downloaded: number;
    bufferedAhead: number;
  };
}

export interface DeviceProfileInput {
  /** @maxItems 10 */
  containers: ("mp4" | "webm" | "mkv" | "avi" | "ts" | "other")[];
  /** @maxItems 20 */
  video: string[];
  /** @maxItems 20 */
  audio: string[];
  audioTracks: boolean;
  embeddedSubtitles: boolean;
  hls: boolean;
}

export interface CreatePlaybackInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex?: number;
  /**
   * @minLength 1
   * @maxLength 100
   */
  mediaFileId?: string;
  title?: PlaybackTitleInput;
  device?: DeviceProfileInput;
  language?: "ru_RU" | "en_US";
  /**
   * @min 0
   * @max 9999
   */
  audioStream?: number;
  /** @pattern ^[sf]\d{1,5}$ */
  subtitle?: string;
  /**
   * @min 0
   * @max 1000000
   */
  startPosition?: number;
}

export interface MediaAudioTrackInput {
  index: number;
  language: string | null;
  title: string | null;
  codec: string;
  channels: number | null;
  bitrate: number | null;
  default: boolean;
  studio: string | null;
  voiceType: string | null;
}

export interface MediaSubtitleTrackInput {
  /** @pattern ^[sf]\d{1,5}$ */
  id: string;
  language: string | null;
  title: string | null;
  codec: string;
  external: boolean;
  forced: boolean;
  default: boolean;
  burnIn: boolean;
}

export interface MediaInfoInput {
  container: "mp4" | "webm" | "mkv" | "avi" | "ts" | "other";
  video: {
    codec: string;
    width: number | null;
    height: number | null;
    hdr: boolean;
  } | null;
  audio: MediaAudioTrackInput[];
  subtitles: MediaSubtitleTrackInput[];
}

export interface PlaybackInput {
  sessionId: string;
  status: "probing" | "ready";
  mode: "direct" | "hls" | null;
  streamUrl: string | null;
  externalUrl: string;
  title: string;
  fileName: string;
  size: number;
  duration: number | null;
  startPosition: number | null;
  media: MediaInfoInput | null;
  audioStream: number | null;
  /** @pattern ^[sf]\d{1,5}$ */
  subtitle: string | null;
  audioSwitch: "platform" | "restart";
  reasons: string[];
  transcode: {
    audio: "copy" | "aac";
    video: {
      encoder: "software" | "vaapi" | "nvenc";
      width: number;
      height: number;
      toneMapping: "gpu" | "software" | null;
    } | null;
  } | null;
}

export interface SubtitleCuesInput {
  cues: {
    start: number;
    end: number;
    text: string;
  }[];
  done: boolean;
}

export interface InsufficientStorageResponseInput {
  message: string;
  kind: "no_space" | "cache_limit";
  needed: number;
  available: number;
  free: number;
  minFree: number;
  cacheLimit: number;
}

export interface UpdateWatchStateInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex?: number;
  /**
   * @minLength 1
   * @maxLength 100
   */
  mediaFileId?: string;
  /**
   * @min 0
   * @max 1000000
   */
  position: number;
  /**
   * @min 0
   * @max 1000000
   */
  duration?: number;
  title?: PlaybackTitleInput;
}

export interface WatchStateInput {
  torrentId: string | null;
  fileIndex: number | null;
  mediaFileId: string | null;
  position: number;
  duration: number | null;
  updatedAt: string;
}

export interface LibraryFolderInput {
  id: string;
  path: string;
  hint: "auto" | "movies" | "shows";
  status: "ok" | "empty" | "offline" | "denied" | "scanning";
  watcher: "on" | "network" | "failed" | "off" | null;
  error: string | null;
  scannedAt: string | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  files: number;
  size: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  missing: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  unsure: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  unmatched: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  pending: number;
}

export interface LibraryInput {
  id: string;
  kind: "video" | "home";
  name: string;
  managed: boolean;
  /** @maxItems 50 */
  exclude: string[];
  watch: boolean;
  hiddenProfiles: string[];
  folders: LibraryFolderInput[];
}

export interface LibraryListInput {
  items: LibraryInput[];
}

export interface CreateLibraryInput {
  kind: "video" | "home";
  /**
   * @minLength 1
   * @maxLength 100
   */
  name: string;
  /**
   * @minLength 1
   * @maxLength 4096
   */
  path: string;
  hint?: "auto" | "movies" | "shows";
}

export interface UpdateLibraryInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name?: string;
  /** @maxItems 50 */
  exclude?: string[];
  watch?: boolean;
  /** @maxItems 50 */
  hiddenProfiles?: string[];
}

export interface AddLibraryFolderInput {
  /**
   * @minLength 1
   * @maxLength 4096
   */
  path: string;
  hint?: "auto" | "movies" | "shows";
}

export interface FolderPathErrorResponseInput {
  message: string;
  kind:
    | "not_absolute"
    | "missing"
    | "not_directory"
    | "denied"
    | "inside_data"
    | "duplicate";
}

export interface FolderBrowseInput {
  path: string;
  parent: string | null;
  entries: {
    name: string;
    path: string;
  }[];
}

export interface UnmatchedGroupInput {
  folderId: string;
  libraryName: string;
  group: string;
  name: string;
  status: "unsure" | "unmatched";
  suggestion: string | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  files: number;
  size: number;
}

export interface UnmatchedGroupListInput {
  items: UnmatchedGroupInput[];
}

export interface LibraryFileItemInput {
  id: string;
  folderId: string;
  relPath: string;
  size: number;
  duration: number | null;
  state: "present" | "missing";
  titleId: string | null;
  matchStatus: "matched" | "unsure" | "unmatched" | "ignored" | null;
  capturedAt: string | null;
  capturedAtSource: "tags" | "name" | "file" | "user" | null;
}

export interface LibraryFileListInput {
  items: LibraryFileItemInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface UpdateLibraryFileInput {
  /**
   * @format date-time
   * @pattern ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$
   */
  capturedAt: string | null;
}

export interface SetGroupTitleInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  folderId: string;
  /**
   * @minLength 1
   * @maxLength 4096
   */
  group: string;
  /** @pattern ^tmdb:(?:movie|tv):\d{1,10}$ */
  titleId: string | null;
  /** @maxItems 5000 */
  episodes?: {
    /**
     * @minLength 1
     * @maxLength 100
     */
    id: string;
    /**
     * @min 0
     * @max 999
     */
    season: number;
    /**
     * @min 1
     * @max 9999
     */
    episode: number | null;
    /**
     * @min 1
     * @max 9999
     */
    episodeTo?: number | null;
  }[];
}

export interface GroupPreviewInput {
  items: {
    id: string;
    relPath: string;
    video: boolean;
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    season: number | null;
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    episode: number | null;
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    episodeTo: number | null;
  }[];
}

export interface LogEntryInput {
  id: number;
  seq: number;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  source:
    | "server"
    | "engine"
    | "playback"
    | "storage"
    | "sources"
    | "catalog"
    | "network"
    | "notifications"
    | "auth";
  message: string;
  details?: string;
  context?: Record<string, string | number | boolean>;
  repeat?: number;
}

export interface LogsResponseInput {
  entries: LogEntryInput[];
  level: "debug" | "info" | "warn" | "error";
  levelLocked: boolean;
  hasMore: boolean;
  instance: string;
}

export interface LogLevelBodyInput {
  level: "info" | "debug";
}

export interface LogLevelResponseInput {
  level: "debug" | "info" | "warn" | "error";
}

export interface TitleCollectionRefInput {
  id: string;
  name: string;
  contains: boolean;
}

export interface TitleMineInput {
  watchlist: boolean;
  favorite: boolean;
  /**
   * @min 1
   * @max 10
   */
  rating: number | null;
  status: "watching" | "waiting" | "watched" | "dropped" | null;
  collections: TitleCollectionRefInput[];
}

export interface UpdateTitleMineInput {
  watchlist?: boolean;
  favorite?: boolean;
  /**
   * @min 1
   * @max 10
   */
  rating?: number | null;
  dropped?: boolean;
}

export interface MineSectionInput {
  id:
    | "continue"
    | "watchlist"
    | "favorites"
    | "collection"
    | "watched"
    | "dropped";
  collectionId?: string;
  name?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count: number;
}

export interface MineResponseInput {
  sections: MineSectionInput[];
}

export interface MineItemsInput {
  items: CardInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface HistoryEntryInput {
  title: CardInput;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  season: number | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  episode: number | null;
  position: number;
  duration: number | null;
  watched: boolean;
  watchedAt: string;
}

export interface ProfileHistoryInput {
  items: HistoryEntryInput[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface NetRouteErrorResponseInput {
  message: string;
  field: "match" | "proxy" | "dohUrl";
  kind: "invalid" | "duplicate" | "default_route";
}

export interface NetRouteInput {
  id: string;
  match: string;
  isDefault: boolean;
  via: "direct" | "socks5h" | "http";
  proxy: string | null;
  envProxy: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
  dns: "system" | "quad9" | "google" | "cloudflare" | "custom";
  dohUrl: string | null;
  updatedAt: string;
}

export interface NetRouteListInput {
  items: NetRouteInput[];
}

export interface CreateNetRouteInput {
  /**
   * @minLength 1
   * @maxLength 253
   */
  match: string;
  via: "direct" | "socks5h" | "http";
  /**
   * @minLength 1
   * @maxLength 300
   */
  proxy?: string;
  /** @maxLength 300 */
  username?: string;
  /** @maxLength 300 */
  password?: string;
  /** @default "system" */
  dns?: "system" | "quad9" | "google" | "cloudflare" | "custom";
  /**
   * @minLength 1
   * @maxLength 2000
   */
  dohUrl?: string;
}

export interface UpdateNetRouteInput {
  /**
   * @minLength 1
   * @maxLength 253
   */
  match?: string;
  via?: "direct" | "socks5h" | "http";
  /**
   * @minLength 1
   * @maxLength 300
   */
  proxy?: string;
  /** @maxLength 300 */
  username?: string | null;
  /** @maxLength 300 */
  password?: string | null;
  dns?: "system" | "quad9" | "google" | "cloudflare" | "custom";
  /**
   * @minLength 1
   * @maxLength 2000
   */
  dohUrl?: string | null;
}

export interface NetRouteOrderInput {
  /** @maxItems 500 */
  ids: string[];
}

export interface DnsProviderListInput {
  items: {
    id: "system" | "quad9" | "google" | "cloudflare" | "custom";
    name: string;
    url: string;
  }[];
}

export interface NetHostInput {
  id: string;
  host: string;
  hostname: string;
  kind: "tmdb" | "tmdb_images" | "manager" | "indexer";
  label: string;
  route: {
    id: string;
    match: string;
    via: "direct" | "socks5h" | "http";
    dns: "system" | "quad9" | "google" | "cloudflare" | "custom";
    envProxy: boolean;
  };
  checking: boolean;
  status: "ok" | "dns" | "doh" | "timeout" | "refused" | "tls" | "http" | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  httpStatus: number | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  latencyMs: number | null;
  dnsSpoofed: boolean;
  checkedAt: string | null;
}

export interface NetCheckStateInput {
  running: boolean;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  done: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
  finishedAt: string | null;
  hosts: NetHostInput[];
}

export interface StartNetCheckInput {
  /**
   * @minLength 1
   * @maxLength 2000
   */
  host?: string;
}

export interface ImdbDatasetStatusInput {
  enabled: boolean;
  state: "off" | "empty" | "updating" | "ready" | "error";
  updatedAt?: string;
  checkedAt?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count?: number;
  error?: {
    kind: "unavailable" | "invalid";
    at: string;
  };
}

export interface MetadataSettingsInput {
  tmdb: {
    source: "custom" | "app" | "none";
    hasAppKey: boolean;
  };
  imdb: ImdbDatasetStatusInput;
}

export interface UpdateImdbSettingsInput {
  enabled: boolean;
}

export interface UpdateMetadataSettingsInput {
  /**
   * @minLength 16
   * @maxLength 1000
   */
  tmdbKey: string | null;
}

export interface CheckMetadataKeyInput {
  /**
   * @minLength 16
   * @maxLength 1000
   */
  tmdbKey?: string;
}

export interface MetadataKeyCheckInput {
  ok: boolean;
  kind: "rejected" | "unavailable" | "missing" | null;
}

export interface ReleaseInfoInput {
  version: string;
  publishedAt?: string;
  url: string;
  notes: string[];
  prerelease: boolean;
}

export interface UpdateStatusResponseInput {
  current: {
    version: string;
    commit?: string;
  };
  docsUrl: string;
  enabled: boolean;
  channel: "stable" | "beta";
  state:
    | "off"
    | "dev"
    | "unsupported"
    | "unknown"
    | "checking"
    | "current"
    | "available"
    | "error";
  latest?: ReleaseInfoInput;
  checkedAt?: string;
  error?: {
    kind: "unavailable" | "rate_limited" | "invalid" | "not_found";
    at: string;
  };
}

export interface UpdateSettingsBodyInput {
  enabled: boolean;
  channel: "stable" | "beta";
}

export interface DismissUpdateBodyInput {
  /**
   * @minLength 1
   * @maxLength 64
   */
  version: string;
}

export interface OverviewUpdateInput {
  version: string;
  publishedAt?: string;
  url: string;
  notes: string[];
  channel: "stable" | "beta";
  docsUrl: string;
}

export interface AttentionItemInput {
  kind:
    | "engine_down"
    | "engine_crashed"
    | "storage_low"
    | "storage_paused"
    | "library_copies"
    | "library_offline"
    | "library_unmatched"
    | "library_watcher"
    | "indexer_error"
    | "indexer_missing"
    | "dns_spoofing"
    | "host_unreachable"
    | "tmdb_key_invalid";
  severity: "error" | "warning";
  section:
    | "downloads"
    | "library"
    | "storage"
    | "sources"
    | "network"
    | "metadata"
    | "logs";
  params: {
    count?: number;
    name?: string;
    reason?: string;
    free?: number;
    minFree?: number;
  };
}

export interface OverviewResponseInput {
  startedAt: string;
  version: string;
  attention: AttentionItemInput[];
  update?: OverviewUpdateInput;
  downloads: {
    total: number;
    active: number;
    downloadSpeed: number;
    uploadSpeed: number;
  };
  storage: {
    usedByCache: number;
    cacheLimit: number;
    free: number;
    total: number;
    minFree: number;
  };
  sources: {
    ok: number;
    total: number;
  };
  devices: {
    total: number;
    watching: number;
  };
}

export interface NotificationParamsInput {
  count?: number;
  name?: string;
  reason?: string;
  free?: number;
  minFree?: number;
  version?: string;
  from?: string;
  type?: string;
}

export interface NotificationItemInput {
  id: string;
  kind:
    | "problem"
    | "update_available"
    | "server_updated"
    | "download_completed"
    | "device_paired"
    | "channel_failing";
  problem?:
    | "engine_down"
    | "engine_crashed"
    | "storage_low"
    | "storage_paused"
    | "library_copies"
    | "library_offline"
    | "library_unmatched"
    | "library_watcher"
    | "indexer_error"
    | "indexer_missing"
    | "dns_spoofing"
    | "host_unreachable"
    | "tmdb_key_invalid";
  severity: "error" | "warning" | "info";
  section?:
    | "downloads"
    | "library"
    | "storage"
    | "sources"
    | "network"
    | "metadata"
    | "logs"
    | "about"
    | "people"
    | "notifications";
  params: NotificationParamsInput;
  createdAt: string;
  readAt?: string;
  resolvedAt?: string;
}

export interface NotificationListInput {
  items: NotificationItemInput[];
  nextCursor?: string;
  unread: number;
}

export interface NotificationUnreadCountInput {
  count: number;
}

export type MarkNotificationsReadBodyInput =
  | {
      /**
       * @maxItems 100
       * @minItems 1
       */
      ids: string[];
    }
  | {
      all: true;
    };

export type NotificationChannelConfigInput = Record<
  string,
  string | number | boolean | null
>;

export interface NotificationChannelBodyInput {
  kind: "telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email";
  /**
   * @minLength 1
   * @maxLength 80
   */
  name: string;
  enabled: boolean;
  language: "ru_RU" | "en_US";
  /** @format uri */
  panelUrl?: string | null;
  config: NotificationChannelConfigInput;
  /** @maxItems 4 */
  events: ("problems" | "updates" | "downloads" | "devices")[];
  includeWarnings: boolean;
  notifyResolved: boolean;
}

export interface NotificationChannelInput {
  id: string;
  kind: "telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email";
  name: string;
  enabled: boolean;
  language: "ru_RU" | "en_US";
  panelUrl?: string;
  config: NotificationChannelConfigInput;
  secrets: string[];
  events: ("problems" | "updates" | "downloads" | "devices")[];
  includeWarnings: boolean;
  notifyResolved: boolean;
  lastSentAt?: string;
  lastError?: {
    kind: string;
    at: string;
  };
  createdAt: string;
}

export interface NotificationChannelListInput {
  kinds: ("telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email")[];
  items: NotificationChannelInput[];
}

export interface NotificationChannelEnabledBodyInput {
  enabled: boolean;
}

export interface NotificationChannelConfigErrorInput {
  message: string;
  fields: string[];
}

export interface NotificationChannelTestBodyInput {
  kind: "telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email";
  /**
   * @minLength 1
   * @maxLength 80
   */
  name: string;
  enabled: boolean;
  language: "ru_RU" | "en_US";
  /** @format uri */
  panelUrl?: string | null;
  config: NotificationChannelConfigInput;
  /** @maxItems 4 */
  events: ("problems" | "updates" | "downloads" | "devices")[];
  includeWarnings: boolean;
  notifyResolved: boolean;
  id?: string;
}

export interface NotificationChannelTestResultInput {
  ok: boolean;
  kind?:
    | "unauthorized"
    | "not_found"
    | "rate_limited"
    | "unavailable"
    | "invalid_response"
    | "invalid_config";
  status?: number;
}

export interface TelegramChatsBodyInput {
  /** @maxLength 200 */
  token?: string;
  id?: string;
}

export interface TelegramChatsInput {
  ok: boolean;
  kind?:
    | "unauthorized"
    | "not_found"
    | "rate_limited"
    | "unavailable"
    | "invalid_response"
    | "invalid_config";
  chats: {
    id: string;
    title: string;
    type: string;
  }[];
}

export interface PlayerSettingsInput {
  autoNext: boolean;
  subtitleSize: "s" | "m" | "l";
  subtitleBackground: "none" | "shadow" | "box";
}

export interface UpdatePlayerSettingsInput {
  autoNext?: boolean;
  subtitleSize?: "s" | "m" | "l";
  subtitleBackground?: "none" | "shadow" | "box";
}

export interface ProfileInput {
  id: string;
  name: string;
  color:
    | "violet"
    | "green"
    | "orange"
    | "blue"
    | "rose"
    | "teal"
    | "amber"
    | "slate";
  language: "ru_RU" | "en_US" | null;
  hasPin: boolean;
  ageLimit: 6 | 12 | 16 | 18 | null;
  posterRatings: ("tmdb" | "imdb")[];
  player: PlayerSettingsInput;
}

export interface ProfileListInput {
  items: ProfileInput[];
  currentId: string;
  selected: boolean;
}

export interface CreateProfileInput {
  /**
   * @minLength 1
   * @maxLength 40
   */
  name: string;
  color:
    | "violet"
    | "green"
    | "orange"
    | "blue"
    | "rose"
    | "teal"
    | "amber"
    | "slate";
  language?: "ru_RU" | "en_US" | null;
  ageLimit?: 6 | 12 | 16 | 18 | null;
  /** @maxItems 10 */
  posterRatings?: ("tmdb" | "imdb")[];
  /** @pattern ^\d{4}$ */
  pin?: string;
}

export interface UpdateProfileInput {
  /**
   * @minLength 1
   * @maxLength 40
   */
  name?: string;
  color?:
    | "violet"
    | "green"
    | "orange"
    | "blue"
    | "rose"
    | "teal"
    | "amber"
    | "slate";
  language?: "ru_RU" | "en_US" | null;
  ageLimit?: 6 | 12 | 16 | 18 | null;
  /** @maxItems 10 */
  posterRatings?: ("tmdb" | "imdb")[];
}

export interface SetProfilePinInput {
  /** @pattern ^\d{4}$ */
  pin: string;
}

export interface SelectProfileInput {
  /** @pattern ^\d{4}$ */
  pin?: string;
}

export interface PinErrorResponseInput {
  message: string;
  kind: "wrong_pin" | "locked";
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  attemptsLeft: number | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  retryAfter: number | null;
}

export interface GpuEncoderInput {
  encoder: "vaapi" | "nvenc";
  device: string | null;
  name: string | null;
  lowPower: boolean;
  decode: string[];
}

export interface PlaybackSettingsInput {
  accel: "auto" | "software";
  encoder: "software" | "vaapi" | "nvenc" | null;
  gpus: GpuEncoderInput[];
  software: boolean;
  softwareFps: number | null;
  softwareMaxHeight: number;
  gpuToneMapping: boolean;
  softwareToneMapping: boolean;
  toneMappingFps: number | null;
  toneMappingMaxHeight: number;
  checkedAt: string;
}

export interface UpdatePlaybackSettingsInput {
  accel: "auto" | "software";
}

export interface WizardStateInput {
  active: boolean;
  step: "storage" | "network" | "sources" | "done";
  skipped: ("storage" | "network" | "sources" | "done")[];
  completedAt: string | null;
}

export interface UpdateWizardInput {
  step: "storage" | "network" | "sources" | "done";
  /** @maxItems 4 */
  skipped: ("storage" | "network" | "sources" | "done")[];
  completed: boolean;
}

export interface StorageDirCheckInput {
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface StorageCheckInput {
  data: StorageDirCheckInput;
  downloads: StorageDirCheckInput;
  library: StorageDirCheckInput;
  linkMode: "hardlink" | "reflink" | "copy" | null;
  space: {
    total: number;
    free: number;
    status: "ok" | "low" | "critical";
  };
}

export interface DiscoveredManagerInput {
  kind: "prowlarr" | "jackett";
  url: string;
}

export interface DiscoverManagersResultInput {
  items: DiscoveredManagerInput[];
}

export interface StorageQueueItemInput {
  torrentId: string;
  name: string;
  sizeOnDisk: number;
  lastAccessAt: string | null;
}

export interface StorageOverviewInput {
  path: string;
  total: number;
  free: number;
  cacheUsed: number;
  keptUsed: number;
  library: {
    path: string;
    used: number;
    shared: number;
    own: number;
    linkMode: "hardlink" | "reflink" | "copy" | null;
  };
  other: number;
  policy: {
    cacheLimit: number;
    minFree: number;
    custom: boolean;
  };
  queue: StorageQueueItemInput[];
}

export interface UpdateStoragePolicyInput {
  /**
   * @min 1073741824
   * @max 1125899906842624
   */
  cacheLimit: number;
  /**
   * @min 1073741824
   * @max 1125899906842624
   */
  minFree: number;
}

export interface UpdateMeInput {
  /** @minLength 2 */
  name?: string;
}

export interface MeResponseInput {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  /** @minLength 8 */
  newPassword: string;
}

export interface ChangeEmailInput {
  /**
   * @format email
   * @pattern ^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$
   */
  email: string;
  currentPassword: string;
}

export interface WrongPasswordResponseInput {
  message: string;
  field: "currentPassword";
}

export interface AboutResponse {
  version: string;
  commit?: string;
  license: string;
  /** @format uri */
  sourceUrl: string;
  imdbAttribution: boolean;
}

export interface Signup {
  /** @minLength 2 */
  name: string;
  /**
   * @format email
   * @pattern ^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$
   */
  email: string;
  /** @minLength 8 */
  password: string;
}

export interface SetupResponse {
  needsSetup: boolean;
}

export interface Signin {
  /**
   * @format email
   * @pattern ^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$
   */
  email: string;
  password: string;
}

export interface MessageResponse {
  message: string;
}

export interface TitleRating {
  provider: string;
  label: string;
  value: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  votes?: number;
}

export interface PosterRating {
  source: "tmdb" | "imdb";
  value: number;
}

export interface Card {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings?: TitleRating[];
  posterRatings?: PosterRating[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
}

export interface TitleSeason {
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  number: number;
  name: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  episodeCount: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  airedEpisodeCount: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
}

export interface TitleDetails {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings: TitleRating[];
  posterRatings?: PosterRating[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
  overview: string;
  genres: string[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  runtime?: number;
  backdrop?: string;
  logo?: string;
  ongoing?: boolean;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  endYear?: number;
  certification?: string;
  countries: string[];
  studios: string[];
  creators: string[];
  seasons?: TitleSeason[];
}

export interface Episode {
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  number: number;
  title: string;
  overview: string;
  airDate?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  runtime?: number;
  still?: string;
}

export interface SeasonDetails {
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  number: number;
  name: string;
  episodes: Episode[];
}

export interface Person {
  id: string;
  name: string;
  role?: string;
  photo?: string;
}

export interface CrewMember {
  id: string;
  name: string;
  photo?: string;
  jobs: ("director" | "creator" | "writer" | "camera" | "music" | "producer")[];
}

export interface CatalogTag {
  id: string;
  name: string;
}

export interface TitleExtras {
  cast: Person[];
  crew: CrewMember[];
  similar: Card[];
  aka: string[];
  directors: string[];
  tags: {
    genres: CatalogTag[];
    studios: CatalogTag[];
    keywords: CatalogTag[];
  };
}

export interface CatalogSearchResponse {
  items: Card[];
  people: Person[];
}

export interface CatalogTrendingResponse {
  items: Card[];
}

export interface CatalogDiscoverResponse {
  items: Card[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  page: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  totalPages: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface CatalogGenresResponse {
  items: CatalogTag[];
}

export interface Backdrop {
  id: string;
  title: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  backdrop: string;
}

export interface CatalogBackdropsResponse {
  items: Backdrop[];
}

export interface PersonCredit {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings?: TitleRating[];
  posterRatings?: PosterRating[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
  detail?: string;
  watched: boolean;
}

export interface PersonDetails {
  id: string;
  name: string;
  photo?: string;
  knownFor?:
    | "acting"
    | "directing"
    | "creator"
    | "writing"
    | "production"
    | "camera"
    | "music"
    | "editing";
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  biography: string;
  credits: {
    role:
      | "acting"
      | "directing"
      | "creator"
      | "writing"
      | "production"
      | "camera"
      | "music"
      | "editing";
    items: PersonCredit[];
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    total: number;
  }[];
}

export interface SourceErrorResponse {
  message: string;
  kind:
    | "auth"
    | "timeout"
    | "unreachable"
    | "bad_response"
    | "remote"
    | "unsupported";
}

export interface Indexer {
  id: string;
  name: string;
  url: string;
  hasApiKey: boolean;
  enabled: boolean;
  managerId: string | null;
  managerKind: "prowlarr" | "jackett" | null;
  missing: boolean;
  categories: {
    id: number;
    name: string;
  }[];
  searchModes: {
    search: boolean;
    tvSearch: boolean;
    movieSearch: boolean;
  } | null;
  checkStatus:
    | "ok"
    | "auth"
    | "timeout"
    | "unreachable"
    | "bad_response"
    | "remote"
    | null;
  checkedAt: string | null;
}

export interface IndexerList {
  items: Indexer[];
}

export interface CreateIndexer {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name: string;
  /**
   * @format uri
   * @maxLength 2000
   */
  url: string;
  /**
   * @minLength 1
   * @maxLength 500
   */
  apiKey?: string;
}

export interface UpdateIndexer {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name?: string;
  enabled?: boolean;
  /**
   * @minLength 1
   * @maxLength 500
   */
  apiKey?: string;
}

export interface IndexerManager {
  id: string;
  kind: "prowlarr" | "jackett";
  url: string;
  syncedAt: string | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  indexerCount: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  missingCount: number;
}

export interface IndexerManagerList {
  items: IndexerManager[];
}

export interface CreateIndexerManager {
  kind: "prowlarr" | "jackett";
  /**
   * @format uri
   * @maxLength 2000
   */
  url: string;
  /**
   * @minLength 1
   * @maxLength 500
   */
  apiKey: string;
}

export interface IndexerManagerSyncResult {
  manager: IndexerManager;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  added: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  updated: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  missing: number;
}

export interface VideoResolution {
  value: "2160p" | "1080p" | "720p" | "SD";
  basis: "probe" | "file" | "title" | "source" | "codec";
  sure: boolean;
}

export interface VoiceRef {
  studio?: string;
  type?: "D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original";
}

export interface AudioTrack {
  type?: "D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original";
  studio?: string;
  language?: string;
}

export interface SourceCandidate {
  id: string;
  title: string;
  indexers: string[];
  size: number | null;
  episodeSize: number | null;
  seeders: number;
  peers: number | null;
  quality:
    | "2160p"
    | "1440p"
    | "1080p"
    | "1080i"
    | "720p"
    | "576p"
    | "480p"
    | "360p"
    | null;
  resolution: VideoResolution | null;
  source: string | null;
  codec: string | null;
  hdr: string[];
  audio: AudioTrack[];
  channels: "2.0" | "5.1" | "7.1" | null;
  subs: string[];
  voice: AudioTrack | null;
  voiceKeys: string[];
  seasons: number[];
  episodes: {
    from: number;
    to: number;
    total?: number;
  } | null;
  isPack: boolean;
  confidence: "high" | "medium";
  pickReason:
    | "pinnedVoice"
    | "profile"
    | "bestQuality"
    | "smaller"
    | "moreSeeders"
    | "originalAudio"
    | null;
  publishedAt: string | null;
  lastWatched: boolean;
}

export interface VoiceOption {
  key: string;
  studio?: string;
  type?: "D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original";
  maxQuality?: "2160p" | "1080p" | "720p" | "SD";
  seeders: number;
  count: number;
  pinned: boolean;
}

export interface TitleSources {
  season: number | null;
  episode: number | null;
  updatedAt: string;
  profile: {
    qualities: ("2160p" | "1080p" | "720p" | "SD")[];
    voiceTypes: ("D" | "MVO" | "DVO" | "VO" | "AVO" | "L" | "Original")[];
  };
  pinnedVoice: VoiceRef | null;
  seasonCandidate: string | null;
  top: string[];
  candidates: SourceCandidate[];
  voices: VoiceOption[];
  query: {
    current: string | null;
    suggestions: string[];
  };
  indexers: {
    total: number;
    failed: {
      name: string;
      kind:
        | "auth"
        | "timeout"
        | "unreachable"
        | "bad_response"
        | "remote"
        | "unsupported";
    }[];
  };
}

export interface PinTitleVoice {
  /**
   * @min 0
   * @max 999
   */
  season: number;
  voice: VoiceRef | null;
}

export interface WatchTitle {
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @min 1
   * @max 9999
   */
  episode?: number;
  /**
   * @minLength 1
   * @maxLength 64
   */
  candidateId?: string;
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
}

export interface TitleWatch {
  status: "ready" | "resolving";
  torrentId: string;
  fileIndex: number | null;
  candidateId: string;
}

export interface WatchErrorResponse {
  message: string;
  kind: "no_sources" | "not_playable" | "candidate_gone";
}

export interface OpenTitle {
  /**
   * @minLength 1
   * @maxLength 64
   */
  candidateId: string;
  /**
   * @minLength 1
   * @maxLength 200
   */
  query?: string;
}

export interface TitleOpen {
  status: "ready" | "resolving";
  torrentId: string;
}

export interface FileDownload {
  state: "downloading" | "downloaded" | "library";
  progress: number;
}

export interface TitleFile {
  fileIndex: number;
  name: string;
  size: number;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number | null;
  watched: boolean;
  download: FileDownload | null;
}

export interface DownloadTitle {
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @minLength 1
   * @maxLength 64
   */
  candidateId?: string;
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
  /**
   * @maxItems 10000
   * @minItems 1
   */
  files?: number[];
}

export interface TitleDownloadStart {
  status: "started" | "resolving";
  torrentId: string;
  candidateId: string;
  files: number;
  bytes: number;
}

export interface LibraryFile {
  id: string;
  season: number | null;
  episode: number | null;
  episodeTo: number | null;
  quality: string | null;
  size: number;
  duration: number | null;
}

export interface TitleLibrary {
  files: LibraryFile[];
}

export interface TitleDownload {
  state: "downloading" | "downloaded" | "library" | null;
  progress: number;
  canKeep: boolean;
  release: {
    quality: string | null;
    voice: VoiceRef | null;
  } | null;
  peers: {
    connected: number;
    found: number;
  };
  speed: number;
  stalled: boolean;
  downloads: {
    torrentId: string;
    phase: "downloading" | "placing" | "unmatched";
    seasons: number[];
    progress: number;
    release: {
      quality: string | null;
      voice: VoiceRef | null;
    } | null;
    peers: {
      connected: number;
      found: number;
    };
    speed: number;
    stalled: boolean;
  }[];
}

export interface TitleFiles {
  status: "ready" | "resolving";
  name: string;
  files: TitleFile[];
}

export interface MarkWatched {
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @min 1
   * @max 9999
   */
  episode?: number;
  watched: boolean;
}

export interface EpisodeProgress {
  season: number;
  episode: number;
  position: number;
  duration: number | null;
  watched: boolean;
}

export interface SeasonRelease {
  season: number;
  torrentId: string;
  quality: "2160p" | "1080p" | "720p" | "SD" | null;
  voice: VoiceRef | null;
  episodes: number[];
}

export interface EpisodeFile {
  torrentId: string;
  fileIndex: number;
}

export interface ResumeTarget {
  season: number | null;
  episode: number | null;
  position: number;
  duration: number | null;
  next: boolean;
  file: EpisodeFile | null;
}

export interface TitleProgress {
  resume: ResumeTarget | null;
  last: {
    season: number | null;
    episode: number | null;
    position: number;
    duration: number | null;
    watched: boolean;
    updatedAt: string;
  } | null;
  seasonReleases: SeasonRelease[];
  episodes: EpisodeProgress[];
}

export interface UpNext {
  next: {
    season: number;
    episode: number;
    title: string;
    still?: string;
    file: EpisodeFile | null;
  } | null;
}

export interface PlaybackTitle {
  /**
   * @minLength 1
   * @maxLength 100
   */
  id: string;
  /**
   * @min 1
   * @max 999
   */
  season?: number;
  /**
   * @min 1
   * @max 9999
   */
  episode?: number;
}

export interface EpisodeCard {
  titleId: string;
  title: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  season: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  episode: number;
  episodeTitle?: string;
  image?: string;
  airDate?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  newCount: number;
}

export interface CatalogRow {
  id:
    | "trending"
    | "trendingMovies"
    | "trendingSeries"
    | "popularMovies"
    | "popularSeries"
    | "russianSeries"
    | "nowPlaying"
    | "onTheAir"
    | "topRatedMovies"
    | "topRatedSeries"
    | "themeSpace"
    | "themeZombies"
    | "themeVampires"
    | "themeDetectives"
    | "themeSpies"
    | "themeDisasters"
    | "themeWar"
    | "themeWesterns"
    | "newEpisodes"
    | "watchlist"
    | "collection"
    | "library"
    | "libraryRecent"
    | "libraryMovies"
    | "librarySeries"
    | "libraryUnmatched"
    | "libraryHomeVideo"
    | "libraryUntitled";
  kind: "top10" | "posters" | "episodes";
  title: string;
  ref?: string;
  name?: string;
  items: Card[];
  episodes?: EpisodeCard[];
}

export interface ReleaseCard {
  torrentId: string;
  name: string;
  matchStatus: "unsure" | "unmatched";
  suggestion: Card | null;
  image?: string;
  query: string;
  seasons: number[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  videos: number;
  size: number;
}

export interface ReleasesRow {
  id: "libraryUnmatched";
  kind: "releases";
  title: string;
  items: ReleaseCard[];
}

export interface FileCard {
  id: string;
  name: string;
  album: string | null;
  capturedAt: string | null;
  duration: number | null;
  share: number;
  thumb: string;
}

export interface FilesRow {
  id: "libraryHomeVideo" | "libraryUntitled";
  kind: "files";
  title: string;
  items: FileCard[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface HomeAlbum {
  libraryId: string;
  album: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count: number;
  from: string | null;
  to: string | null;
  coverId: string;
}

export interface HomeVideoSection {
  albums: HomeAlbum[];
}

export interface HomeVideoList {
  items: FileCard[];
}

export interface ContinueCard {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  year?: number;
  poster?: string;
  ratings?: TitleRating[];
  posterRatings?: PosterRating[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  ownRating?: number;
  availability?: "downloading" | "downloaded" | "library";
  downloadProgress?: number;
  image?: string;
  season: number | null;
  episode: number | null;
  episodeTitle?: string;
  position: number;
  duration: number | null;
  next: boolean;
  file: EpisodeFile | null;
}

export interface ContinueRow {
  id: "continue";
  kind: "continue";
  title: string;
  items: ContinueCard[];
}

export type HomeRow = ContinueRow | ReleasesRow | FilesRow | CatalogRow;

export interface HomeResponse {
  rows: HomeRow[];
}

export interface Collection {
  id: string;
  name: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count: number;
  showOnHome: boolean;
  hiddenFrom: string[];
}

export interface CollectionList {
  items: Collection[];
}

export interface CreateCollection {
  /**
   * @minLength 1
   * @maxLength 60
   */
  name: string;
  showOnHome?: boolean;
  /** @maxItems 100 */
  hiddenFrom?: string[];
}

export interface UpdateCollection {
  /**
   * @minLength 1
   * @maxLength 60
   */
  name?: string;
  showOnHome?: boolean;
  /** @maxItems 100 */
  hiddenFrom?: string[];
}

export interface CollectionTitles {
  items: Card[];
}

export interface CollectionErrorResponse {
  message: string;
  kind: "duplicate";
}

export interface StartPairing {
  type?: "tv" | "browser" | "other";
}

export interface Pairing {
  secret: string;
  code: string;
  expiresAt: string;
}

export interface PairingStatus {
  status: "pending" | "approved" | "expired";
  expiresAt: string;
  device: {
    id: string;
    name: string;
  } | null;
}

export interface ConfirmPairing {
  /**
   * @minLength 1
   * @maxLength 20
   */
  code: string;
  /**
   * @minLength 1
   * @maxLength 60
   */
  name: string;
}

export interface ConfirmedPairing {
  name: string;
  type: "tv" | "browser" | "other";
}

export interface PairingErrorResponse {
  message: string;
  kind: "invalid" | "expired";
}

export interface Device {
  id: string;
  name: string;
  type: "tv" | "browser" | "other";
  profile: {
    id: string;
    name: string;
    color:
      | "violet"
      | "green"
      | "orange"
      | "blue"
      | "rose"
      | "teal"
      | "amber"
      | "slate";
  } | null;
  address: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  watching: boolean;
}

export interface DeviceList {
  items: Device[];
}

export interface UpdateDevice {
  /**
   * @minLength 1
   * @maxLength 60
   */
  name: string;
}

export interface EngineUnavailableResponse {
  message: string;
  kind: "not_installed" | "starting" | "stopped";
}

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
  isVideo: boolean;
  downloaded: number;
  selected: boolean;
  inLibrary: boolean;
}

export interface Torrent {
  id: string;
  infoHash: string;
  name: string;
  source: "magnet" | "file";
  status: "resolving" | "ready" | "failed";
  error: "timeout" | "rejected" | "failed" | null;
  files: TorrentFile[];
  totalSize: number;
  addedAt: string;
  lastAccessAt: string | null;
  titleId: string | null;
  matchStatus: "matched" | "unsure" | "unmatched" | "ignored" | "user" | null;
  matchSuggestion: string | null;
  retention: "cache" | "keep";
  inLibrary: boolean;
  pauseReason: "user" | "storage" | null;
  state:
    | "idle"
    | "partial"
    | "downloading"
    | "stalled"
    | "seeding"
    | "complete"
    | "paused";
  streaming: boolean;
  progress: {
    downloaded: number;
    wanted: number;
  };
  sizeOnDisk: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: {
    connected: number;
    found: number;
  };
}

export interface TorrentList {
  items: Torrent[];
  engine: "ready" | "not_installed" | "starting" | "stopped";
  totals: {
    downloadSpeed: number;
    uploadSpeed: number;
  };
  cache: {
    used: number;
    limit: number;
  };
}

export interface DownloadTorrent {
  /**
   * @maxItems 10000
   * @minItems 1
   */
  files: number[];
}

export interface UpdateTorrentTitle {
  /** @pattern ^tmdb:(?:movie|tv):\d{1,10}$ */
  titleId: string | null;
}

export interface UpdateRetention {
  retention: "cache" | "keep";
}

export interface CreateTorrent {
  /**
   * @maxLength 20000
   * @pattern ^magnet:\?
   */
  magnet?: string;
  /**
   * @format base64
   * @maxLength 11184812
   * @pattern ^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$
   */
  torrentFile?: string;
}

export interface TorrentStats {
  activity: "idle" | "downloading";
  peers: {
    connected: number;
    found: number;
  };
  downloadSpeed: number;
  uploadSpeed: number;
  file: {
    size: number;
    downloaded: number;
    bufferedAhead: number;
  };
}

export interface DeviceProfile {
  /** @maxItems 10 */
  containers: ("mp4" | "webm" | "mkv" | "avi" | "ts" | "other")[];
  /** @maxItems 20 */
  video: string[];
  /** @maxItems 20 */
  audio: string[];
  audioTracks: boolean;
  embeddedSubtitles: boolean;
  hls: boolean;
}

export interface CreatePlayback {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex?: number;
  /**
   * @minLength 1
   * @maxLength 100
   */
  mediaFileId?: string;
  title?: PlaybackTitle;
  device?: DeviceProfile;
  language?: "ru_RU" | "en_US";
  /**
   * @min 0
   * @max 9999
   */
  audioStream?: number;
  /** @pattern ^[sf]\d{1,5}$ */
  subtitle?: string;
  /**
   * @min 0
   * @max 1000000
   */
  startPosition?: number;
}

export interface MediaAudioTrack {
  index: number;
  language: string | null;
  title: string | null;
  codec: string;
  channels: number | null;
  bitrate: number | null;
  default: boolean;
  studio: string | null;
  voiceType: string | null;
}

export interface MediaSubtitleTrack {
  /** @pattern ^[sf]\d{1,5}$ */
  id: string;
  language: string | null;
  title: string | null;
  codec: string;
  external: boolean;
  forced: boolean;
  default: boolean;
  burnIn: boolean;
}

export interface MediaInfo {
  container: "mp4" | "webm" | "mkv" | "avi" | "ts" | "other";
  video: {
    codec: string;
    width: number | null;
    height: number | null;
    hdr: boolean;
  } | null;
  audio: MediaAudioTrack[];
  subtitles: MediaSubtitleTrack[];
}

export interface Playback {
  sessionId: string;
  status: "probing" | "ready";
  mode: "direct" | "hls" | null;
  streamUrl: string | null;
  externalUrl: string;
  title: string;
  fileName: string;
  size: number;
  duration: number | null;
  startPosition: number | null;
  media: MediaInfo | null;
  audioStream: number | null;
  /** @pattern ^[sf]\d{1,5}$ */
  subtitle: string | null;
  audioSwitch: "platform" | "restart";
  reasons: string[];
  transcode: {
    audio: "copy" | "aac";
    video: {
      encoder: "software" | "vaapi" | "nvenc";
      width: number;
      height: number;
      toneMapping: "gpu" | "software" | null;
    } | null;
  } | null;
}

export interface SubtitleCues {
  cues: {
    start: number;
    end: number;
    text: string;
  }[];
  done: boolean;
}

export interface InsufficientStorageResponse {
  message: string;
  kind: "no_space" | "cache_limit";
  needed: number;
  available: number;
  free: number;
  minFree: number;
  cacheLimit: number;
}

export interface UpdateWatchState {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId?: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex?: number;
  /**
   * @minLength 1
   * @maxLength 100
   */
  mediaFileId?: string;
  /**
   * @min 0
   * @max 1000000
   */
  position: number;
  /**
   * @min 0
   * @max 1000000
   */
  duration?: number;
  title?: PlaybackTitle;
}

export interface WatchState {
  torrentId: string | null;
  fileIndex: number | null;
  mediaFileId: string | null;
  position: number;
  duration: number | null;
  updatedAt: string;
}

export interface LibraryFolder {
  id: string;
  path: string;
  hint: "auto" | "movies" | "shows";
  status: "ok" | "empty" | "offline" | "denied" | "scanning";
  watcher: "on" | "network" | "failed" | "off" | null;
  error: string | null;
  scannedAt: string | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  files: number;
  size: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  missing: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  unsure: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  unmatched: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  pending: number;
}

export interface Library {
  id: string;
  kind: "video" | "home";
  name: string;
  managed: boolean;
  /** @maxItems 50 */
  exclude: string[];
  watch: boolean;
  hiddenProfiles: string[];
  folders: LibraryFolder[];
}

export interface LibraryList {
  items: Library[];
}

export interface CreateLibrary {
  kind: "video" | "home";
  /**
   * @minLength 1
   * @maxLength 100
   */
  name: string;
  /**
   * @minLength 1
   * @maxLength 4096
   */
  path: string;
  hint?: "auto" | "movies" | "shows";
}

export interface UpdateLibrary {
  /**
   * @minLength 1
   * @maxLength 100
   */
  name?: string;
  /** @maxItems 50 */
  exclude?: string[];
  watch?: boolean;
  /** @maxItems 50 */
  hiddenProfiles?: string[];
}

export interface AddLibraryFolder {
  /**
   * @minLength 1
   * @maxLength 4096
   */
  path: string;
  hint?: "auto" | "movies" | "shows";
}

export interface FolderPathErrorResponse {
  message: string;
  kind:
    | "not_absolute"
    | "missing"
    | "not_directory"
    | "denied"
    | "inside_data"
    | "duplicate";
}

export interface FolderBrowse {
  path: string;
  parent: string | null;
  entries: {
    name: string;
    path: string;
  }[];
}

export interface UnmatchedGroup {
  folderId: string;
  libraryName: string;
  group: string;
  name: string;
  status: "unsure" | "unmatched";
  suggestion: string | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  files: number;
  size: number;
}

export interface UnmatchedGroupList {
  items: UnmatchedGroup[];
}

export interface LibraryFileItem {
  id: string;
  folderId: string;
  relPath: string;
  size: number;
  duration: number | null;
  state: "present" | "missing";
  titleId: string | null;
  matchStatus: "matched" | "unsure" | "unmatched" | "ignored" | null;
  capturedAt: string | null;
  capturedAtSource: "tags" | "name" | "file" | "user" | null;
}

export interface LibraryFileList {
  items: LibraryFileItem[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface UpdateLibraryFile {
  /**
   * @format date-time
   * @pattern ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$
   */
  capturedAt: string | null;
}

export interface SetGroupTitle {
  /**
   * @minLength 1
   * @maxLength 100
   */
  folderId: string;
  /**
   * @minLength 1
   * @maxLength 4096
   */
  group: string;
  /** @pattern ^tmdb:(?:movie|tv):\d{1,10}$ */
  titleId: string | null;
  /** @maxItems 5000 */
  episodes?: {
    /**
     * @minLength 1
     * @maxLength 100
     */
    id: string;
    /**
     * @min 0
     * @max 999
     */
    season: number;
    /**
     * @min 1
     * @max 9999
     */
    episode: number | null;
    /**
     * @min 1
     * @max 9999
     */
    episodeTo?: number | null;
  }[];
}

export interface GroupPreview {
  items: {
    id: string;
    relPath: string;
    video: boolean;
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    season: number | null;
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    episode: number | null;
    /**
     * @min -9007199254740991
     * @max 9007199254740991
     */
    episodeTo: number | null;
  }[];
}

export interface LogEntry {
  id: number;
  seq: number;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  source:
    | "server"
    | "engine"
    | "playback"
    | "storage"
    | "sources"
    | "catalog"
    | "network"
    | "notifications"
    | "auth";
  message: string;
  details?: string;
  context?: Record<string, string | number | boolean>;
  repeat?: number;
}

export interface LogsResponse {
  entries: LogEntry[];
  level: "debug" | "info" | "warn" | "error";
  levelLocked: boolean;
  hasMore: boolean;
  instance: string;
}

export interface LogLevelBody {
  level: "info" | "debug";
}

export interface LogLevelResponse {
  level: "debug" | "info" | "warn" | "error";
}

export interface TitleCollectionRef {
  id: string;
  name: string;
  contains: boolean;
}

export interface TitleMine {
  watchlist: boolean;
  favorite: boolean;
  /**
   * @min 1
   * @max 10
   */
  rating: number | null;
  status: "watching" | "waiting" | "watched" | "dropped" | null;
  collections: TitleCollectionRef[];
}

export interface UpdateTitleMine {
  watchlist?: boolean;
  favorite?: boolean;
  /**
   * @min 1
   * @max 10
   */
  rating?: number | null;
  dropped?: boolean;
}

export interface MineSection {
  id:
    | "continue"
    | "watchlist"
    | "favorites"
    | "collection"
    | "watched"
    | "dropped";
  collectionId?: string;
  name?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count: number;
}

export interface MineResponse {
  sections: MineSection[];
}

export interface MineItems {
  items: Card[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface HistoryEntry {
  title: Card;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  season: number | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  episode: number | null;
  position: number;
  duration: number | null;
  watched: boolean;
  watchedAt: string;
}

export interface ProfileHistory {
  items: HistoryEntry[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
}

export interface NetRouteErrorResponse {
  message: string;
  field: "match" | "proxy" | "dohUrl";
  kind: "invalid" | "duplicate" | "default_route";
}

export interface NetRoute {
  id: string;
  match: string;
  isDefault: boolean;
  via: "direct" | "socks5h" | "http";
  proxy: string | null;
  envProxy: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
  dns: "system" | "quad9" | "google" | "cloudflare" | "custom";
  dohUrl: string | null;
  updatedAt: string;
}

export interface NetRouteList {
  items: NetRoute[];
}

export interface CreateNetRoute {
  /**
   * @minLength 1
   * @maxLength 253
   */
  match: string;
  via: "direct" | "socks5h" | "http";
  /**
   * @minLength 1
   * @maxLength 300
   */
  proxy?: string;
  /** @maxLength 300 */
  username?: string;
  /** @maxLength 300 */
  password?: string;
  /** @default "system" */
  dns: "system" | "quad9" | "google" | "cloudflare" | "custom";
  /**
   * @minLength 1
   * @maxLength 2000
   */
  dohUrl?: string;
}

export interface UpdateNetRoute {
  /**
   * @minLength 1
   * @maxLength 253
   */
  match?: string;
  via?: "direct" | "socks5h" | "http";
  /**
   * @minLength 1
   * @maxLength 300
   */
  proxy?: string;
  /** @maxLength 300 */
  username?: string | null;
  /** @maxLength 300 */
  password?: string | null;
  dns?: "system" | "quad9" | "google" | "cloudflare" | "custom";
  /**
   * @minLength 1
   * @maxLength 2000
   */
  dohUrl?: string | null;
}

export interface NetRouteOrder {
  /** @maxItems 500 */
  ids: string[];
}

export interface DnsProviderList {
  items: {
    id: "system" | "quad9" | "google" | "cloudflare" | "custom";
    name: string;
    url: string;
  }[];
}

export interface NetHost {
  id: string;
  host: string;
  hostname: string;
  kind: "tmdb" | "tmdb_images" | "manager" | "indexer";
  label: string;
  route: {
    id: string;
    match: string;
    via: "direct" | "socks5h" | "http";
    dns: "system" | "quad9" | "google" | "cloudflare" | "custom";
    envProxy: boolean;
  };
  checking: boolean;
  status: "ok" | "dns" | "doh" | "timeout" | "refused" | "tls" | "http" | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  httpStatus: number | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  latencyMs: number | null;
  dnsSpoofed: boolean;
  checkedAt: string | null;
}

export interface NetCheckState {
  running: boolean;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  done: number;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  total: number;
  finishedAt: string | null;
  hosts: NetHost[];
}

export interface StartNetCheck {
  /**
   * @minLength 1
   * @maxLength 2000
   */
  host?: string;
}

export interface ImdbDatasetStatus {
  enabled: boolean;
  state: "off" | "empty" | "updating" | "ready" | "error";
  updatedAt?: string;
  checkedAt?: string;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  count?: number;
  error?: {
    kind: "unavailable" | "invalid";
    at: string;
  };
}

export interface MetadataSettings {
  tmdb: {
    source: "custom" | "app" | "none";
    hasAppKey: boolean;
  };
  imdb: ImdbDatasetStatus;
}

export interface UpdateImdbSettings {
  enabled: boolean;
}

export interface UpdateMetadataSettings {
  /**
   * @minLength 16
   * @maxLength 1000
   */
  tmdbKey: string | null;
}

export interface CheckMetadataKey {
  /**
   * @minLength 16
   * @maxLength 1000
   */
  tmdbKey?: string;
}

export interface MetadataKeyCheck {
  ok: boolean;
  kind: "rejected" | "unavailable" | "missing" | null;
}

export interface ReleaseInfo {
  version: string;
  publishedAt?: string;
  url: string;
  notes: string[];
  prerelease: boolean;
}

export interface UpdateStatusResponse {
  current: {
    version: string;
    commit?: string;
  };
  docsUrl: string;
  enabled: boolean;
  channel: "stable" | "beta";
  state:
    | "off"
    | "dev"
    | "unsupported"
    | "unknown"
    | "checking"
    | "current"
    | "available"
    | "error";
  latest?: ReleaseInfo;
  checkedAt?: string;
  error?: {
    kind: "unavailable" | "rate_limited" | "invalid" | "not_found";
    at: string;
  };
}

export interface UpdateSettingsBody {
  enabled: boolean;
  channel: "stable" | "beta";
}

export interface DismissUpdateBody {
  /**
   * @minLength 1
   * @maxLength 64
   */
  version: string;
}

export interface OverviewUpdate {
  version: string;
  publishedAt?: string;
  url: string;
  notes: string[];
  channel: "stable" | "beta";
  docsUrl: string;
}

export interface AttentionItem {
  kind:
    | "engine_down"
    | "engine_crashed"
    | "storage_low"
    | "storage_paused"
    | "library_copies"
    | "library_offline"
    | "library_unmatched"
    | "library_watcher"
    | "indexer_error"
    | "indexer_missing"
    | "dns_spoofing"
    | "host_unreachable"
    | "tmdb_key_invalid";
  severity: "error" | "warning";
  section:
    | "downloads"
    | "library"
    | "storage"
    | "sources"
    | "network"
    | "metadata"
    | "logs";
  params: {
    count?: number;
    name?: string;
    reason?: string;
    free?: number;
    minFree?: number;
  };
}

export interface OverviewResponse {
  startedAt: string;
  version: string;
  attention: AttentionItem[];
  update?: OverviewUpdate;
  downloads: {
    total: number;
    active: number;
    downloadSpeed: number;
    uploadSpeed: number;
  };
  storage: {
    usedByCache: number;
    cacheLimit: number;
    free: number;
    total: number;
    minFree: number;
  };
  sources: {
    ok: number;
    total: number;
  };
  devices: {
    total: number;
    watching: number;
  };
}

export interface NotificationParams {
  count?: number;
  name?: string;
  reason?: string;
  free?: number;
  minFree?: number;
  version?: string;
  from?: string;
  type?: string;
}

export interface NotificationItem {
  id: string;
  kind:
    | "problem"
    | "update_available"
    | "server_updated"
    | "download_completed"
    | "device_paired"
    | "channel_failing";
  problem?:
    | "engine_down"
    | "engine_crashed"
    | "storage_low"
    | "storage_paused"
    | "library_copies"
    | "library_offline"
    | "library_unmatched"
    | "library_watcher"
    | "indexer_error"
    | "indexer_missing"
    | "dns_spoofing"
    | "host_unreachable"
    | "tmdb_key_invalid";
  severity: "error" | "warning" | "info";
  section?:
    | "downloads"
    | "library"
    | "storage"
    | "sources"
    | "network"
    | "metadata"
    | "logs"
    | "about"
    | "people"
    | "notifications";
  params: NotificationParams;
  createdAt: string;
  readAt?: string;
  resolvedAt?: string;
}

export interface NotificationList {
  items: NotificationItem[];
  nextCursor?: string;
  unread: number;
}

export interface NotificationUnreadCount {
  count: number;
}

export type MarkNotificationsReadBody =
  | {
      /**
       * @maxItems 100
       * @minItems 1
       */
      ids: string[];
    }
  | {
      all: true;
    };

export type NotificationChannelConfig = Record<
  string,
  string | number | boolean | null
>;

export interface NotificationChannelBody {
  kind: "telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email";
  /**
   * @minLength 1
   * @maxLength 80
   */
  name: string;
  enabled: boolean;
  language: "ru_RU" | "en_US";
  /** @format uri */
  panelUrl?: string | null;
  config: NotificationChannelConfig;
  /** @maxItems 4 */
  events: ("problems" | "updates" | "downloads" | "devices")[];
  includeWarnings: boolean;
  notifyResolved: boolean;
}

export interface NotificationChannel {
  id: string;
  kind: "telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email";
  name: string;
  enabled: boolean;
  language: "ru_RU" | "en_US";
  panelUrl?: string;
  config: NotificationChannelConfig;
  secrets: string[];
  events: ("problems" | "updates" | "downloads" | "devices")[];
  includeWarnings: boolean;
  notifyResolved: boolean;
  lastSentAt?: string;
  lastError?: {
    kind: string;
    at: string;
  };
  createdAt: string;
}

export interface NotificationChannelList {
  kinds: ("telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email")[];
  items: NotificationChannel[];
}

export interface NotificationChannelEnabledBody {
  enabled: boolean;
}

export interface NotificationChannelConfigError {
  message: string;
  fields: string[];
}

export interface NotificationChannelTestBody {
  kind: "telegram" | "webhook" | "ntfy" | "gotify" | "apprise" | "email";
  /**
   * @minLength 1
   * @maxLength 80
   */
  name: string;
  enabled: boolean;
  language: "ru_RU" | "en_US";
  /** @format uri */
  panelUrl?: string | null;
  config: NotificationChannelConfig;
  /** @maxItems 4 */
  events: ("problems" | "updates" | "downloads" | "devices")[];
  includeWarnings: boolean;
  notifyResolved: boolean;
  id?: string;
}

export interface NotificationChannelTestResult {
  ok: boolean;
  kind?:
    | "unauthorized"
    | "not_found"
    | "rate_limited"
    | "unavailable"
    | "invalid_response"
    | "invalid_config";
  status?: number;
}

export interface TelegramChatsBody {
  /** @maxLength 200 */
  token?: string;
  id?: string;
}

export interface TelegramChats {
  ok: boolean;
  kind?:
    | "unauthorized"
    | "not_found"
    | "rate_limited"
    | "unavailable"
    | "invalid_response"
    | "invalid_config";
  chats: {
    id: string;
    title: string;
    type: string;
  }[];
}

export interface PlayerSettings {
  autoNext: boolean;
  subtitleSize: "s" | "m" | "l";
  subtitleBackground: "none" | "shadow" | "box";
}

export interface UpdatePlayerSettings {
  autoNext?: boolean;
  subtitleSize?: "s" | "m" | "l";
  subtitleBackground?: "none" | "shadow" | "box";
}

export interface Profile {
  id: string;
  name: string;
  color:
    | "violet"
    | "green"
    | "orange"
    | "blue"
    | "rose"
    | "teal"
    | "amber"
    | "slate";
  language: "ru_RU" | "en_US" | null;
  hasPin: boolean;
  ageLimit: 6 | 12 | 16 | 18 | null;
  posterRatings: ("tmdb" | "imdb")[];
  player: PlayerSettings;
}

export interface ProfileList {
  items: Profile[];
  currentId: string;
  selected: boolean;
}

export interface CreateProfile {
  /**
   * @minLength 1
   * @maxLength 40
   */
  name: string;
  color:
    | "violet"
    | "green"
    | "orange"
    | "blue"
    | "rose"
    | "teal"
    | "amber"
    | "slate";
  language?: "ru_RU" | "en_US" | null;
  ageLimit?: 6 | 12 | 16 | 18 | null;
  /** @maxItems 10 */
  posterRatings?: ("tmdb" | "imdb")[];
  /** @pattern ^\d{4}$ */
  pin?: string;
}

export interface UpdateProfile {
  /**
   * @minLength 1
   * @maxLength 40
   */
  name?: string;
  color?:
    | "violet"
    | "green"
    | "orange"
    | "blue"
    | "rose"
    | "teal"
    | "amber"
    | "slate";
  language?: "ru_RU" | "en_US" | null;
  ageLimit?: 6 | 12 | 16 | 18 | null;
  /** @maxItems 10 */
  posterRatings?: ("tmdb" | "imdb")[];
}

export interface SetProfilePin {
  /** @pattern ^\d{4}$ */
  pin: string;
}

export interface SelectProfile {
  /** @pattern ^\d{4}$ */
  pin?: string;
}

export interface PinErrorResponse {
  message: string;
  kind: "wrong_pin" | "locked";
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  attemptsLeft: number | null;
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  retryAfter: number | null;
}

export interface GpuEncoder {
  encoder: "vaapi" | "nvenc";
  device: string | null;
  name: string | null;
  lowPower: boolean;
  decode: string[];
}

export interface PlaybackSettings {
  accel: "auto" | "software";
  encoder: "software" | "vaapi" | "nvenc" | null;
  gpus: GpuEncoder[];
  software: boolean;
  softwareFps: number | null;
  softwareMaxHeight: number;
  gpuToneMapping: boolean;
  softwareToneMapping: boolean;
  toneMappingFps: number | null;
  toneMappingMaxHeight: number;
  checkedAt: string;
}

export interface UpdatePlaybackSettings {
  accel: "auto" | "software";
}

export interface WizardState {
  active: boolean;
  step: "storage" | "network" | "sources" | "done";
  skipped: ("storage" | "network" | "sources" | "done")[];
  completedAt: string | null;
}

export interface UpdateWizard {
  step: "storage" | "network" | "sources" | "done";
  /** @maxItems 4 */
  skipped: ("storage" | "network" | "sources" | "done")[];
  completed: boolean;
}

export interface StorageDirCheck {
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface StorageCheck {
  data: StorageDirCheck;
  downloads: StorageDirCheck;
  library: StorageDirCheck;
  linkMode: "hardlink" | "reflink" | "copy" | null;
  space: {
    total: number;
    free: number;
    status: "ok" | "low" | "critical";
  };
}

export interface DiscoveredManager {
  kind: "prowlarr" | "jackett";
  url: string;
}

export interface DiscoverManagersResult {
  items: DiscoveredManager[];
}

export interface StorageQueueItem {
  torrentId: string;
  name: string;
  sizeOnDisk: number;
  lastAccessAt: string | null;
}

export interface StorageOverview {
  path: string;
  total: number;
  free: number;
  cacheUsed: number;
  keptUsed: number;
  library: {
    path: string;
    used: number;
    shared: number;
    own: number;
    linkMode: "hardlink" | "reflink" | "copy" | null;
  };
  other: number;
  policy: {
    cacheLimit: number;
    minFree: number;
    custom: boolean;
  };
  queue: StorageQueueItem[];
}

export interface UpdateStoragePolicy {
  /**
   * @min 1073741824
   * @max 1125899906842624
   */
  cacheLimit: number;
  /**
   * @min 1073741824
   * @max 1125899906842624
   */
  minFree: number;
}

export interface UpdateMe {
  /** @minLength 2 */
  name?: string;
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

export interface ChangePassword {
  currentPassword: string;
  /** @minLength 8 */
  newPassword: string;
}

export interface ChangeEmail {
  /**
   * @format email
   * @pattern ^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$
   */
  email: string;
  currentPassword: string;
}

export interface WrongPasswordResponse {
  message: string;
  field: "currentPassword";
}

export type GetOverviewError = MessageResponse;

export type GetUpdateStatusError = MessageResponse;

export type UpdateUpdateSettingsError = MessageResponse;

export type CheckForUpdatesError = MessageResponse;

export type DismissUpdateError = MessageResponse;

export type GetNotificationsError = MessageResponse;

export type GetUnreadNotificationsError = MessageResponse;

export type MarkNotificationsReadError = MessageResponse;

export type GetNotificationChannelsError = MessageResponse;

export type CreateNotificationChannelError =
  MessageResponse | NotificationChannelConfigError;

export type UpdateNotificationChannelError =
  MessageResponse | NotificationChannelConfigError;

export type SetNotificationChannelEnabledError = MessageResponse;

export type DeleteNotificationChannelError = MessageResponse;

export type TestNotificationChannelError = MessageResponse;

export type TestNotificationChannelDraftError =
  MessageResponse | NotificationChannelConfigError;

export type FindTelegramChatsError = MessageResponse;

export type PostAuthSignupError = MessageResponse;

export type PostAuthSigninError = MessageResponse;

export type PostAuthRefreshError = MessageResponse;

export type GetUsersMeError = MessageResponse;

export type PatchUsersMeError = MessageResponse;

export type PutUsersMePasswordError = MessageResponse | WrongPasswordResponse;

export type PutUsersMeEmailError = MessageResponse | WrongPasswordResponse;

export type GetCatalogSearchError = MessageResponse;

export type GetCatalogTitleError = MessageResponse;

export type GetCatalogSeasonError = MessageResponse;

export type GetCatalogTitleExtrasError = MessageResponse;

export type GetCatalogPersonError = MessageResponse;

export type GetCatalogDiscoverError = MessageResponse;

export type GetCatalogGenresError = MessageResponse;

export type GetCatalogTrendingError = MessageResponse;

export type GetCatalogBackdropsError = MessageResponse;

export type GetHomeError = MessageResponse;

export type GetHomeContinueError = MessageResponse;

export type GetIndexersError = MessageResponse;

export type PostIndexerError = MessageResponse | SourceErrorResponse;

export type PatchIndexerError = MessageResponse;

export type DeleteIndexerError = MessageResponse;

export type PostIndexerTestError = MessageResponse;

export type GetIndexerManagersError = MessageResponse;

export type PostIndexerManagerError = MessageResponse | SourceErrorResponse;

export type PostIndexerManagerSyncError = MessageResponse | SourceErrorResponse;

export type DeleteIndexerManagerError = MessageResponse;

export type GetTitleSourcesError = MessageResponse;

export type PutTitleVoiceError = MessageResponse;

export type PostTitleWatchError =
  MessageResponse | WatchErrorResponse | EngineUnavailableResponse;

export type GetTitleProgressError = MessageResponse;

export type GetTitleUpNextError = MessageResponse;

export type PostTitleOpenError =
  MessageResponse | WatchErrorResponse | EngineUnavailableResponse;

export type GetTitleFilesError = MessageResponse;

export type GetTitleLibraryError = MessageResponse;

export type GetTitleDownloadError = MessageResponse;

export type PostTitleDownloadError =
  | MessageResponse
  | WatchErrorResponse
  | EngineUnavailableResponse
  | InsufficientStorageResponse;

export type DeleteTitleDownloadError =
  MessageResponse | EngineUnavailableResponse;

export type PostTitleKeepError =
  MessageResponse | EngineUnavailableResponse | InsufficientStorageResponse;

export type PutTitleWatchedError = MessageResponse;

export type GetTitleMineError = MessageResponse;

export type PatchTitleMineError = MessageResponse;

export type GetMineError = MessageResponse;

export type GetMineItemsError = MessageResponse;

export type GetCollectionsError = MessageResponse;

export type PostCollectionError = MessageResponse | CollectionErrorResponse;

export type PatchCollectionError = MessageResponse | CollectionErrorResponse;

export type DeleteCollectionError = MessageResponse;

export type GetCollectionTitlesError = MessageResponse;

export type PutCollectionTitleError = MessageResponse;

export type DeleteCollectionTitleError = MessageResponse;

export type GetTorrentsError = MessageResponse;

export type PostTorrentError = MessageResponse | EngineUnavailableResponse;

export type GetTorrentError = MessageResponse;

export type DeleteTorrentError = MessageResponse | EngineUnavailableResponse;

export type PostTorrentRetryError = MessageResponse | EngineUnavailableResponse;

export type PostTorrentDownloadError =
  MessageResponse | EngineUnavailableResponse;

export type PostTorrentPauseError = MessageResponse | EngineUnavailableResponse;

export type PostTorrentResumeError =
  MessageResponse | EngineUnavailableResponse;

export type PutTorrentRetentionError =
  MessageResponse | EngineUnavailableResponse;

export type PutTorrentTitleError = MessageResponse;

export type DeleteTorrentLibraryError =
  MessageResponse | EngineUnavailableResponse;

export type GetTorrentStatsError = MessageResponse | EngineUnavailableResponse;

export type GetHomeVideoError = MessageResponse;

export type GetHomeVideosError = MessageResponse;

export type GetLibrariesError = MessageResponse;

export type PostLibraryError = MessageResponse | FolderPathErrorResponse;

export type PatchLibraryError = MessageResponse;

export type DeleteLibraryError = MessageResponse;

export type PostLibraryFolderError = MessageResponse | FolderPathErrorResponse;

export type DeleteLibraryFolderError = MessageResponse;

export type PostLibraryFolderScanError = MessageResponse;

export type GetLibraryBrowseError = MessageResponse;

export type GetLibraryUnmatchedError = MessageResponse;

export type PutLibraryGroupTitleError = MessageResponse;

export type GetLibraryGroupPreviewError = MessageResponse;

export type GetLibraryFilesError = MessageResponse;

export type PatchLibraryFileError = MessageResponse;

export type GetStorageError = MessageResponse | EngineUnavailableResponse;

export type PutStoragePolicyError = MessageResponse | EngineUnavailableResponse;

export type GetNetRoutesError = MessageResponse;

export type PostNetRouteError = MessageResponse | NetRouteErrorResponse;

export type PatchNetRouteError = MessageResponse | NetRouteErrorResponse;

export type DeleteNetRouteError = MessageResponse | NetRouteErrorResponse;

export type PutNetRouteOrderError = MessageResponse;

export type GetNetDnsProvidersError = MessageResponse;

export type GetNetCheckError = MessageResponse;

export type PostNetCheckError = MessageResponse;

export type GetMetadataSettingsError = MessageResponse;

export type PutMetadataSettingsError = MessageResponse;

export type PostMetadataCheckError = MessageResponse;

export type PutImdbSettingsError = MessageResponse;

export type PostImdbRefreshError = MessageResponse;

export type GetPlaybackSettingsError = MessageResponse;

export type PutPlaybackSettingsError = MessageResponse;

export type PostPlaybackCheckError = MessageResponse;

export type GetSetupWizardError = MessageResponse;

export type PutSetupWizardError = MessageResponse;

export type GetSetupStorageCheckError = MessageResponse;

export type PostSetupDiscoverManagersError = MessageResponse;

export type PostPlaybackError =
  MessageResponse | EngineUnavailableResponse | InsufficientStorageResponse;

export type GetPlaybackError = MessageResponse;

export type DeletePlaybackError = MessageResponse;

export type GetPlaybackSubtitlesError = MessageResponse;

export type PutWatchStateError = MessageResponse;

export type GetProfilesError = MessageResponse;

export type PostProfileError = MessageResponse;

export type PutCurrentPlayerSettingsError = MessageResponse;

export type PatchProfileError = MessageResponse;

export type DeleteProfileError = MessageResponse;

export type GetProfileHistoryError = MessageResponse;

export type PutProfilePinError = MessageResponse;

export type DeleteProfilePinError = MessageResponse;

export type PostProfileSelectError = MessageResponse | PinErrorResponse;

export type PostDevicePairingError = MessageResponse;

export type GetDevicePairingError = MessageResponse;

export type PostDevicePairingConfirmError =
  MessageResponse | PairingErrorResponse;

export type GetDevicesError = MessageResponse;

export type PatchDeviceError = MessageResponse;

export type DeleteDeviceError = MessageResponse;

export type RestartEngineError = MessageResponse | EngineUnavailableResponse;

export type GetLogsError = MessageResponse;

export type PutLogLevelError = MessageResponse;

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<
  FullRequestParams,
  "body" | "method" | "query" | "path"
>;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (
    securityData: SecurityDataType | null,
  ) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<
  D extends unknown,
  E extends unknown = unknown,
> extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  JsonApi = "application/vnd.api+json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) =>
    fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter(
      (key) => "undefined" !== typeof query[key],
    );
    return keys
      .map((key) =>
        Array.isArray(query[key])
          ? this.addArrayQueryParam(query, key)
          : this.addQueryParam(query, key),
      )
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.JsonApi]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.Text]: (input: any) =>
      input !== null && typeof input !== "string"
        ? JSON.stringify(input)
        : input,
    [ContentType.FormData]: (input: any) => {
      if (input instanceof FormData) {
        return input;
      }

      return Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
              ? JSON.stringify(property)
              : `${property}`,
        );
        return formData;
      }, new FormData());
    },
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(
    params1: RequestParams,
    params2?: RequestParams,
  ): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (
    cancelToken: CancelToken,
  ): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<T> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(
      `${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`,
      {
        ...requestParams,
        headers: {
          ...(requestParams.headers || {}),
          ...(type && type !== ContentType.FormData
            ? { "Content-Type": type }
            : {}),
        },
        signal:
          (cancelToken
            ? this.createAbortSignal(cancelToken)
            : requestParams.signal) || null,
        body:
          typeof body === "undefined" || body === null
            ? null
            : payloadFormatter(body),
      },
    ).then(async (response) => {
      const r = response as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const responseToParse = responseFormat ? response.clone() : response;
      const data = !responseFormat
        ? r
        : await responseToParse[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data.data;
    });
  };
}

/**
 * @title Torsher API
 * @version 0.0.0
 */
export class Api<
  SecurityDataType extends unknown,
> extends HttpClient<SecurityDataType> {
  health = {
    /**
     * No description
     *
     * @tags Health
     * @name GetHealth
     * @request GET:/api/health
     */
    getHealth: (params: RequestParams = {}) =>
      this.request<
        {
          status: "ok";
        },
        any
      >({
        path: `/api/health`,
        method: "GET",
        format: "json",
        ...params,
      }),
  };
  about = {
    /**
     * No description
     *
     * @tags About
     * @name GetAbout
     * @request GET:/api/about/
     */
    getAbout: (params: RequestParams = {}) =>
      this.request<AboutResponse, any>({
        path: `/api/about/`,
        method: "GET",
        format: "json",
        ...params,
      }),
  };
  overview = {
    /**
     * No description
     *
     * @tags Overview
     * @name GetOverview
     * @request GET:/api/overview
     */
    getOverview: (params: RequestParams = {}) =>
      this.request<OverviewResponse, GetOverviewError>({
        path: `/api/overview`,
        method: "GET",
        format: "json",
        ...params,
      }),
  };
  updates = {
    /**
     * No description
     *
     * @tags Updates
     * @name GetUpdateStatus
     * @request GET:/api/updates
     */
    getUpdateStatus: (params: RequestParams = {}) =>
      this.request<UpdateStatusResponse, GetUpdateStatusError>({
        path: `/api/updates`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Updates
     * @name UpdateUpdateSettings
     * @request PUT:/api/updates/settings
     */
    updateUpdateSettings: (
      data: UpdateSettingsBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<UpdateStatusResponse, UpdateUpdateSettingsError>({
        path: `/api/updates/settings`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Updates
     * @name CheckForUpdates
     * @request POST:/api/updates/check
     */
    checkForUpdates: (params: RequestParams = {}) =>
      this.request<UpdateStatusResponse, CheckForUpdatesError>({
        path: `/api/updates/check`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Updates
     * @name DismissUpdate
     * @request POST:/api/updates/dismiss
     */
    dismissUpdate: (data: DismissUpdateBodyInput, params: RequestParams = {}) =>
      this.request<null, DismissUpdateError>({
        path: `/api/updates/dismiss`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  notifications = {
    /**
     * No description
     *
     * @tags Notifications
     * @name GetNotifications
     * @request GET:/api/notifications
     */
    getNotifications: (
      query?: {
        before?: string;
        /**
         * @min 1
         * @max 100
         * @default 20
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<NotificationList, GetNotificationsError>({
        path: `/api/notifications`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name GetUnreadNotifications
     * @request GET:/api/notifications/unread
     */
    getUnreadNotifications: (params: RequestParams = {}) =>
      this.request<NotificationUnreadCount, GetUnreadNotificationsError>({
        path: `/api/notifications/unread`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name MarkNotificationsRead
     * @request POST:/api/notifications/read
     */
    markNotificationsRead: (
      data: MarkNotificationsReadBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<null, MarkNotificationsReadError>({
        path: `/api/notifications/read`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name GetNotificationChannels
     * @request GET:/api/notifications/channels
     */
    getNotificationChannels: (params: RequestParams = {}) =>
      this.request<NotificationChannelList, GetNotificationChannelsError>({
        path: `/api/notifications/channels`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name CreateNotificationChannel
     * @request POST:/api/notifications/channels
     */
    createNotificationChannel: (
      data: NotificationChannelBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<NotificationChannel, CreateNotificationChannelError>({
        path: `/api/notifications/channels`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name UpdateNotificationChannel
     * @request PUT:/api/notifications/channels/{id}
     */
    updateNotificationChannel: (
      id: string,
      data: NotificationChannelBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<NotificationChannel, UpdateNotificationChannelError>({
        path: `/api/notifications/channels/${id}`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name SetNotificationChannelEnabled
     * @request PATCH:/api/notifications/channels/{id}
     */
    setNotificationChannelEnabled: (
      id: string,
      data: NotificationChannelEnabledBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<NotificationChannel, SetNotificationChannelEnabledError>({
        path: `/api/notifications/channels/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name DeleteNotificationChannel
     * @request DELETE:/api/notifications/channels/{id}
     */
    deleteNotificationChannel: (id: string, params: RequestParams = {}) =>
      this.request<null, DeleteNotificationChannelError>({
        path: `/api/notifications/channels/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name TestNotificationChannel
     * @request POST:/api/notifications/channels/{id}/test
     */
    testNotificationChannel: (id: string, params: RequestParams = {}) =>
      this.request<NotificationChannelTestResult, TestNotificationChannelError>(
        {
          path: `/api/notifications/channels/${id}/test`,
          method: "POST",
          format: "json",
          ...params,
        },
      ),

    /**
     * No description
     *
     * @tags Notifications
     * @name TestNotificationChannelDraft
     * @request POST:/api/notifications/channels/test
     */
    testNotificationChannelDraft: (
      data: NotificationChannelTestBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<
        NotificationChannelTestResult,
        TestNotificationChannelDraftError
      >({
        path: `/api/notifications/channels/test`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Notifications
     * @name FindTelegramChats
     * @request POST:/api/notifications/telegram/chats
     */
    findTelegramChats: (
      data: TelegramChatsBodyInput,
      params: RequestParams = {},
    ) =>
      this.request<TelegramChats, FindTelegramChatsError>({
        path: `/api/notifications/telegram/chats`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  auth = {
    /**
     * No description
     *
     * @tags Auth
     * @name GetAuthSetup
     * @request GET:/api/auth/setup
     */
    getAuthSetup: (params: RequestParams = {}) =>
      this.request<SetupResponse, any>({
        path: `/api/auth/setup`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Auth
     * @name PostAuthSignup
     * @request POST:/api/auth/signup
     */
    postAuthSignup: (data: SignupInput, params: RequestParams = {}) =>
      this.request<MessageResponse, PostAuthSignupError>({
        path: `/api/auth/signup`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Auth
     * @name PostAuthSignin
     * @request POST:/api/auth/signin
     */
    postAuthSignin: (data: SigninInput, params: RequestParams = {}) =>
      this.request<MessageResponse, PostAuthSigninError>({
        path: `/api/auth/signin`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Auth
     * @name PostAuthRefresh
     * @request POST:/api/auth/refresh
     */
    postAuthRefresh: (params: RequestParams = {}) =>
      this.request<MessageResponse, PostAuthRefreshError>({
        path: `/api/auth/refresh`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Auth
     * @name PostAuthLogout
     * @request POST:/api/auth/logout
     */
    postAuthLogout: (params: RequestParams = {}) =>
      this.request<MessageResponse, any>({
        path: `/api/auth/logout`,
        method: "POST",
        format: "json",
        ...params,
      }),
  };
  users = {
    /**
     * No description
     *
     * @tags Users
     * @name GetUsersMe
     * @request GET:/api/users/me
     */
    getUsersMe: (params: RequestParams = {}) =>
      this.request<MeResponse, GetUsersMeError>({
        path: `/api/users/me`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Users
     * @name PatchUsersMe
     * @request PATCH:/api/users/me
     */
    patchUsersMe: (data: UpdateMeInput, params: RequestParams = {}) =>
      this.request<MeResponse, PatchUsersMeError>({
        path: `/api/users/me`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Users
     * @name PutUsersMePassword
     * @request PUT:/api/users/me/password
     */
    putUsersMePassword: (
      data: ChangePasswordInput,
      params: RequestParams = {},
    ) =>
      this.request<MessageResponse, PutUsersMePasswordError>({
        path: `/api/users/me/password`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Users
     * @name PutUsersMeEmail
     * @request PUT:/api/users/me/email
     */
    putUsersMeEmail: (data: ChangeEmailInput, params: RequestParams = {}) =>
      this.request<MeResponse, PutUsersMeEmailError>({
        path: `/api/users/me/email`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  catalog = {
    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogSearch
     * @request GET:/api/catalog/search
     */
    getCatalogSearch: (
      query: {
        /**
         * @minLength 1
         * @maxLength 200
         */
        query: string;
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CatalogSearchResponse, GetCatalogSearchError>({
        path: `/api/catalog/search`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogTitle
     * @request GET:/api/catalog/titles/{id}
     */
    getCatalogTitle: (
      id: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleDetails, GetCatalogTitleError>({
        path: `/api/catalog/titles/${id}`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogSeason
     * @request GET:/api/catalog/titles/{id}/seasons/{number}
     */
    getCatalogSeason: (
      id: string,
      number: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<SeasonDetails, GetCatalogSeasonError>({
        path: `/api/catalog/titles/${id}/seasons/${number}`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogTitleExtras
     * @request GET:/api/catalog/titles/{id}/extras
     */
    getCatalogTitleExtras: (
      id: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleExtras, GetCatalogTitleExtrasError>({
        path: `/api/catalog/titles/${id}/extras`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogPerson
     * @request GET:/api/catalog/people/{id}
     */
    getCatalogPerson: (
      id: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<PersonDetails, GetCatalogPersonError>({
        path: `/api/catalog/people/${id}`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogDiscover
     * @request GET:/api/catalog/discover
     */
    getCatalogDiscover: (
      query?: {
        /** @default "movies" */
        type?: "movies" | "series" | "cartoons" | "cartoonSeries" | "anime";
        /** @pattern ^\d{1,9}$ */
        genre?: string;
        /**
         * @min 1900
         * @max 2100
         */
        year?: number;
        /**
         * @min 1900
         * @multipleOf 10
         * @max 2090
         */
        decade?: number;
        /**
         * @min 1
         * @max 9
         */
        rating?: number;
        /** @pattern ^[a-z]{2}$ */
        originalLanguage?: string;
        /** @pattern ^[A-Z]{2}$ */
        country?: string;
        /** @pattern ^\d{1,9}$ */
        keyword?: string;
        /** @pattern ^(?:company|network):\d{1,9}$ */
        studio?: string;
        /** @default "popularity" */
        sort?: "popularity" | "rating" | "date";
        /**
         * @min 1
         * @max 500
         * @default 1
         */
        page?: number;
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CatalogDiscoverResponse, GetCatalogDiscoverError>({
        path: `/api/catalog/discover`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogGenres
     * @request GET:/api/catalog/genres
     */
    getCatalogGenres: (
      query?: {
        /** @default "movies" */
        type?: "movies" | "series" | "cartoons" | "cartoonSeries" | "anime";
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CatalogGenresResponse, GetCatalogGenresError>({
        path: `/api/catalog/genres`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogTrending
     * @request GET:/api/catalog/trending
     */
    getCatalogTrending: (
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CatalogTrendingResponse, GetCatalogTrendingError>({
        path: `/api/catalog/trending`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetCatalogBackdrops
     * @request GET:/api/catalog/backdrops
     */
    getCatalogBackdrops: (
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CatalogBackdropsResponse, GetCatalogBackdropsError>({
        path: `/api/catalog/backdrops`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  home = {
    /**
     * No description
     *
     * @tags Catalog
     * @name GetHome
     * @request GET:/api/home
     */
    getHome: (
      query?: {
        /** @default "all" */
        mode?: "all" | "movies" | "series" | "library";
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<HomeResponse, GetHomeError>({
        path: `/api/home`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Catalog
     * @name GetHomeContinue
     * @request GET:/api/home/continue
     */
    getHomeContinue: (
      query?: {
        /** @default "all" */
        mode?: "all" | "movies" | "series" | "library";
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<ContinueRow, GetHomeContinueError>({
        path: `/api/home/continue`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  indexers = {
    /**
     * No description
     *
     * @tags Sources
     * @name GetIndexers
     * @request GET:/api/indexers
     */
    getIndexers: (params: RequestParams = {}) =>
      this.request<IndexerList, GetIndexersError>({
        path: `/api/indexers`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name PostIndexer
     * @request POST:/api/indexers
     */
    postIndexer: (data: CreateIndexerInput, params: RequestParams = {}) =>
      this.request<Indexer, PostIndexerError>({
        path: `/api/indexers`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name PatchIndexer
     * @request PATCH:/api/indexers/{id}
     */
    patchIndexer: (
      id: string,
      data: UpdateIndexerInput,
      params: RequestParams = {},
    ) =>
      this.request<Indexer, PatchIndexerError>({
        path: `/api/indexers/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name DeleteIndexer
     * @request DELETE:/api/indexers/{id}
     */
    deleteIndexer: (id: string, params: RequestParams = {}) =>
      this.request<MessageResponse, DeleteIndexerError>({
        path: `/api/indexers/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name PostIndexerTest
     * @request POST:/api/indexers/{id}/test
     */
    postIndexerTest: (id: string, params: RequestParams = {}) =>
      this.request<Indexer, PostIndexerTestError>({
        path: `/api/indexers/${id}/test`,
        method: "POST",
        format: "json",
        ...params,
      }),
  };
  indexerManagers = {
    /**
     * No description
     *
     * @tags Sources
     * @name GetIndexerManagers
     * @request GET:/api/indexer-managers
     */
    getIndexerManagers: (params: RequestParams = {}) =>
      this.request<IndexerManagerList, GetIndexerManagersError>({
        path: `/api/indexer-managers`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name PostIndexerManager
     * @request POST:/api/indexer-managers
     */
    postIndexerManager: (
      data: CreateIndexerManagerInput,
      params: RequestParams = {},
    ) =>
      this.request<IndexerManagerSyncResult, PostIndexerManagerError>({
        path: `/api/indexer-managers`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name PostIndexerManagerSync
     * @request POST:/api/indexer-managers/{id}/sync
     */
    postIndexerManagerSync: (id: string, params: RequestParams = {}) =>
      this.request<IndexerManagerSyncResult, PostIndexerManagerSyncError>({
        path: `/api/indexer-managers/${id}/sync`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Sources
     * @name DeleteIndexerManager
     * @request DELETE:/api/indexer-managers/{id}
     */
    deleteIndexerManager: (
      id: string,
      query?: {
        /** @default "keep" */
        indexers?: "keep" | "delete";
      },
      params: RequestParams = {},
    ) =>
      this.request<MessageResponse, DeleteIndexerManagerError>({
        path: `/api/indexer-managers/${id}`,
        method: "DELETE",
        query: query,
        format: "json",
        ...params,
      }),
  };
  titles = {
    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleSources
     * @request GET:/api/titles/{id}/sources
     */
    getTitleSources: (
      id: string,
      query?: {
        /** @pattern ^[1-9]\d{0,2}$ */
        season?: string;
        /** @pattern ^[1-9]\d{0,3}$ */
        episode?: string;
        refresh?: "1";
        all?: "1";
        /**
         * @minLength 1
         * @maxLength 200
         */
        query?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleSources, GetTitleSourcesError>({
        path: `/api/titles/${id}/sources`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PutTitleVoice
     * @request PUT:/api/titles/{id}/voice
     */
    putTitleVoice: (
      id: string,
      data: PinTitleVoiceInput,
      params: RequestParams = {},
    ) =>
      this.request<PinTitleVoice, PutTitleVoiceError>({
        path: `/api/titles/${id}/voice`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PostTitleWatch
     * @request POST:/api/titles/{id}/watch
     */
    postTitleWatch: (
      id: string,
      data: WatchTitleInput,
      params: RequestParams = {},
    ) =>
      this.request<TitleWatch, PostTitleWatchError>({
        path: `/api/titles/${id}/watch`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleProgress
     * @request GET:/api/titles/{id}/progress
     */
    getTitleProgress: (
      id: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleProgress, GetTitleProgressError>({
        path: `/api/titles/${id}/progress`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleUpNext
     * @request GET:/api/titles/{id}/up-next
     */
    getTitleUpNext: (
      id: string,
      query: {
        /** @pattern ^[1-9]\d{0,2}$ */
        season: string;
        /** @pattern ^[1-9]\d{0,3}$ */
        episode: string;
        /**
         * @minLength 1
         * @maxLength 100
         */
        torrentId?: string;
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<UpNext, GetTitleUpNextError>({
        path: `/api/titles/${id}/up-next`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PostTitleOpen
     * @request POST:/api/titles/{id}/open
     */
    postTitleOpen: (
      id: string,
      data: OpenTitleInput,
      params: RequestParams = {},
    ) =>
      this.request<TitleOpen, PostTitleOpenError>({
        path: `/api/titles/${id}/open`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleFiles
     * @request GET:/api/titles/{id}/files/{torrentId}
     */
    getTitleFiles: (
      id: string,
      torrentId: string,
      params: RequestParams = {},
    ) =>
      this.request<TitleFiles, GetTitleFilesError>({
        path: `/api/titles/${id}/files/${torrentId}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleLibrary
     * @request GET:/api/titles/{id}/library
     */
    getTitleLibrary: (id: string, params: RequestParams = {}) =>
      this.request<TitleLibrary, GetTitleLibraryError>({
        path: `/api/titles/${id}/library`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleDownload
     * @request GET:/api/titles/{id}/download
     */
    getTitleDownload: (id: string, params: RequestParams = {}) =>
      this.request<TitleDownload, GetTitleDownloadError>({
        path: `/api/titles/${id}/download`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PostTitleDownload
     * @request POST:/api/titles/{id}/download
     */
    postTitleDownload: (
      id: string,
      data: DownloadTitleInput,
      params: RequestParams = {},
    ) =>
      this.request<TitleDownloadStart, PostTitleDownloadError>({
        path: `/api/titles/${id}/download`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name DeleteTitleDownload
     * @request DELETE:/api/titles/{id}/download
     */
    deleteTitleDownload: (
      id: string,
      query?: {
        /**
         * @minLength 1
         * @maxLength 100
         */
        torrentId?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleDownload, DeleteTitleDownloadError>({
        path: `/api/titles/${id}/download`,
        method: "DELETE",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PostTitleKeep
     * @request POST:/api/titles/{id}/keep
     */
    postTitleKeep: (id: string, params: RequestParams = {}) =>
      this.request<TitleDownload, PostTitleKeepError>({
        path: `/api/titles/${id}/keep`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PutTitleWatched
     * @request PUT:/api/titles/{id}/watched
     */
    putTitleWatched: (
      id: string,
      data: MarkWatchedInput,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<MarkWatched, PutTitleWatchedError>({
        path: `/api/titles/${id}/watched`,
        method: "PUT",
        query: query,
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name GetTitleMine
     * @request GET:/api/titles/{id}/mine
     */
    getTitleMine: (
      id: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleMine, GetTitleMineError>({
        path: `/api/titles/${id}/mine`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Titles
     * @name PatchTitleMine
     * @request PATCH:/api/titles/{id}/mine
     */
    patchTitleMine: (
      id: string,
      data: UpdateTitleMineInput,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TitleMine, PatchTitleMineError>({
        path: `/api/titles/${id}/mine`,
        method: "PATCH",
        query: query,
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  mine = {
    /**
     * No description
     *
     * @tags Mine
     * @name GetMine
     * @request GET:/api/mine
     */
    getMine: (
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<MineResponse, GetMineError>({
        path: `/api/mine`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Mine
     * @name GetMineItems
     * @request GET:/api/mine/items
     */
    getMineItems: (
      query: {
        section:
          | "continue"
          | "watchlist"
          | "favorites"
          | "collection"
          | "watched"
          | "dropped";
        /** @maxLength 100 */
        collection?: string;
        /** @default "added" */
        sort?: "added" | "rating";
        /** @default "all" */
        kind?: "all" | "movie" | "series";
        /** @default "any" */
        rating?: "any" | "rated" | "unrated" | "9-10" | "7-8" | "5-6" | "1-4";
        /**
         * @min 0
         * @max 9007199254740991
         * @default 0
         */
        offset?: number;
        /**
         * @min 1
         * @max 40
         * @default 40
         */
        limit?: number;
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<MineItems, GetMineItemsError>({
        path: `/api/mine/items`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  collections = {
    /**
     * No description
     *
     * @tags Collections
     * @name GetCollections
     * @request GET:/api/collections
     */
    getCollections: (params: RequestParams = {}) =>
      this.request<CollectionList, GetCollectionsError>({
        path: `/api/collections`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Collections
     * @name PostCollection
     * @request POST:/api/collections
     */
    postCollection: (data: CreateCollectionInput, params: RequestParams = {}) =>
      this.request<Collection, PostCollectionError>({
        path: `/api/collections`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Collections
     * @name PatchCollection
     * @request PATCH:/api/collections/{id}
     */
    patchCollection: (
      id: string,
      data: UpdateCollectionInput,
      params: RequestParams = {},
    ) =>
      this.request<Collection, PatchCollectionError>({
        path: `/api/collections/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Collections
     * @name DeleteCollection
     * @request DELETE:/api/collections/{id}
     */
    deleteCollection: (id: string, params: RequestParams = {}) =>
      this.request<MessageResponse, DeleteCollectionError>({
        path: `/api/collections/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Collections
     * @name GetCollectionTitles
     * @request GET:/api/collections/{id}/titles
     */
    getCollectionTitles: (
      id: string,
      query?: {
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionTitles, GetCollectionTitlesError>({
        path: `/api/collections/${id}/titles`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Collections
     * @name PutCollectionTitle
     * @request PUT:/api/collections/{id}/titles/{titleId}
     */
    putCollectionTitle: (
      id: string,
      titleId: string,
      params: RequestParams = {},
    ) =>
      this.request<MessageResponse, PutCollectionTitleError>({
        path: `/api/collections/${id}/titles/${titleId}`,
        method: "PUT",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Collections
     * @name DeleteCollectionTitle
     * @request DELETE:/api/collections/{id}/titles/{titleId}
     */
    deleteCollectionTitle: (
      id: string,
      titleId: string,
      params: RequestParams = {},
    ) =>
      this.request<MessageResponse, DeleteCollectionTitleError>({
        path: `/api/collections/${id}/titles/${titleId}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),
  };
  torrents = {
    /**
     * No description
     *
     * @tags Torrents
     * @name GetTorrents
     * @request GET:/api/torrents
     */
    getTorrents: (params: RequestParams = {}) =>
      this.request<TorrentList, GetTorrentsError>({
        path: `/api/torrents`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PostTorrent
     * @request POST:/api/torrents
     */
    postTorrent: (data: CreateTorrentInput, params: RequestParams = {}) =>
      this.request<Torrent, PostTorrentError>({
        path: `/api/torrents`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name GetTorrent
     * @request GET:/api/torrents/{id}
     */
    getTorrent: (id: string, params: RequestParams = {}) =>
      this.request<Torrent, GetTorrentError>({
        path: `/api/torrents/${id}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name DeleteTorrent
     * @request DELETE:/api/torrents/{id}
     */
    deleteTorrent: (
      id: string,
      query?: {
        files?: "keep" | "delete";
      },
      params: RequestParams = {},
    ) =>
      this.request<MessageResponse, DeleteTorrentError>({
        path: `/api/torrents/${id}`,
        method: "DELETE",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PostTorrentRetry
     * @request POST:/api/torrents/{id}/retry
     */
    postTorrentRetry: (id: string, params: RequestParams = {}) =>
      this.request<Torrent, PostTorrentRetryError>({
        path: `/api/torrents/${id}/retry`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PostTorrentDownload
     * @request POST:/api/torrents/{id}/download
     */
    postTorrentDownload: (
      id: string,
      data: DownloadTorrentInput,
      params: RequestParams = {},
    ) =>
      this.request<Torrent, PostTorrentDownloadError>({
        path: `/api/torrents/${id}/download`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PostTorrentPause
     * @request POST:/api/torrents/{id}/pause
     */
    postTorrentPause: (id: string, params: RequestParams = {}) =>
      this.request<Torrent, PostTorrentPauseError>({
        path: `/api/torrents/${id}/pause`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PostTorrentResume
     * @request POST:/api/torrents/{id}/resume
     */
    postTorrentResume: (id: string, params: RequestParams = {}) =>
      this.request<Torrent, PostTorrentResumeError>({
        path: `/api/torrents/${id}/resume`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PutTorrentRetention
     * @request PUT:/api/torrents/{id}/retention
     */
    putTorrentRetention: (
      id: string,
      data: UpdateRetentionInput,
      params: RequestParams = {},
    ) =>
      this.request<Torrent, PutTorrentRetentionError>({
        path: `/api/torrents/${id}/retention`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name PutTorrentTitle
     * @request PUT:/api/torrents/{id}/title
     */
    putTorrentTitle: (
      id: string,
      data: UpdateTorrentTitleInput,
      params: RequestParams = {},
    ) =>
      this.request<Torrent, PutTorrentTitleError>({
        path: `/api/torrents/${id}/title`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name DeleteTorrentLibrary
     * @request DELETE:/api/torrents/{id}/library
     */
    deleteTorrentLibrary: (id: string, params: RequestParams = {}) =>
      this.request<Torrent, DeleteTorrentLibraryError>({
        path: `/api/torrents/${id}/library`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Torrents
     * @name GetTorrentStats
     * @request GET:/api/torrents/{id}/stats
     */
    getTorrentStats: (
      id: string,
      query: {
        /** @pattern ^\d{1,5}$ */
        fileIndex: string;
        /** @pattern ^\d{1,16}$ */
        offset?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TorrentStats, GetTorrentStatsError>({
        path: `/api/torrents/${id}/stats`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  library = {
    /**
     * No description
     *
     * @tags Library
     * @name GetHomeVideo
     * @request GET:/api/library/home
     */
    getHomeVideo: (params: RequestParams = {}) =>
      this.request<HomeVideoSection, GetHomeVideoError>({
        path: `/api/library/home`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Library
     * @name GetHomeVideos
     * @request GET:/api/library/home/videos
     */
    getHomeVideos: (
      query?: {
        /**
         * @minLength 1
         * @maxLength 100
         */
        libraryId?: string;
        /** @maxLength 4096 */
        album?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<HomeVideoList, GetHomeVideosError>({
        path: `/api/library/home/videos`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  libraries = {
    /**
     * No description
     *
     * @tags Libraries
     * @name GetLibraries
     * @request GET:/api/libraries
     */
    getLibraries: (params: RequestParams = {}) =>
      this.request<LibraryList, GetLibrariesError>({
        path: `/api/libraries`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name PostLibrary
     * @request POST:/api/libraries
     */
    postLibrary: (data: CreateLibraryInput, params: RequestParams = {}) =>
      this.request<Library, PostLibraryError>({
        path: `/api/libraries`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name PatchLibrary
     * @request PATCH:/api/libraries/{id}
     */
    patchLibrary: (
      id: string,
      data: UpdateLibraryInput,
      params: RequestParams = {},
    ) =>
      this.request<Library, PatchLibraryError>({
        path: `/api/libraries/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name DeleteLibrary
     * @request DELETE:/api/libraries/{id}
     */
    deleteLibrary: (id: string, params: RequestParams = {}) =>
      this.request<null, DeleteLibraryError>({
        path: `/api/libraries/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name PostLibraryFolder
     * @request POST:/api/libraries/{id}/folders
     */
    postLibraryFolder: (
      id: string,
      data: AddLibraryFolderInput,
      params: RequestParams = {},
    ) =>
      this.request<Library, PostLibraryFolderError>({
        path: `/api/libraries/${id}/folders`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name DeleteLibraryFolder
     * @request DELETE:/api/libraries/folders/{folderId}
     */
    deleteLibraryFolder: (folderId: string, params: RequestParams = {}) =>
      this.request<null, DeleteLibraryFolderError>({
        path: `/api/libraries/folders/${folderId}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name PostLibraryFolderScan
     * @request POST:/api/libraries/folders/{folderId}/scan
     */
    postLibraryFolderScan: (folderId: string, params: RequestParams = {}) =>
      this.request<null, PostLibraryFolderScanError>({
        path: `/api/libraries/folders/${folderId}/scan`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name GetLibraryBrowse
     * @request GET:/api/libraries/browse
     */
    getLibraryBrowse: (
      query?: {
        /** @maxLength 4096 */
        path?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<FolderBrowse, GetLibraryBrowseError>({
        path: `/api/libraries/browse`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name GetLibraryUnmatched
     * @request GET:/api/libraries/unmatched
     */
    getLibraryUnmatched: (params: RequestParams = {}) =>
      this.request<UnmatchedGroupList, GetLibraryUnmatchedError>({
        path: `/api/libraries/unmatched`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name PutLibraryGroupTitle
     * @request PUT:/api/libraries/groups/title
     */
    putLibraryGroupTitle: (
      data: SetGroupTitleInput,
      params: RequestParams = {},
    ) =>
      this.request<null, PutLibraryGroupTitleError>({
        path: `/api/libraries/groups/title`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name GetLibraryGroupPreview
     * @request GET:/api/libraries/groups/preview
     */
    getLibraryGroupPreview: (
      query: {
        /**
         * @minLength 1
         * @maxLength 100
         */
        folderId: string;
        /**
         * @minLength 1
         * @maxLength 4096
         */
        group: string;
        /** @pattern ^tmdb:(?:movie|tv):\d{1,10}$ */
        titleId: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<GroupPreview, GetLibraryGroupPreviewError>({
        path: `/api/libraries/groups/preview`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name GetLibraryFiles
     * @request GET:/api/libraries/{id}/files
     */
    getLibraryFiles: (
      id: string,
      query?: {
        /**
         * @min 0
         * @max 9007199254740991
         * @default 0
         */
        offset?: number;
        /**
         * @min 1
         * @max 200
         * @default 50
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<LibraryFileList, GetLibraryFilesError>({
        path: `/api/libraries/${id}/files`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Libraries
     * @name PatchLibraryFile
     * @request PATCH:/api/libraries/files/{fileId}
     */
    patchLibraryFile: (
      fileId: string,
      data: UpdateLibraryFileInput,
      params: RequestParams = {},
    ) =>
      this.request<null, PatchLibraryFileError>({
        path: `/api/libraries/files/${fileId}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  storage = {
    /**
     * No description
     *
     * @tags Storage
     * @name GetStorage
     * @request GET:/api/storage
     */
    getStorage: (params: RequestParams = {}) =>
      this.request<StorageOverview, GetStorageError>({
        path: `/api/storage`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Storage
     * @name PutStoragePolicy
     * @request PUT:/api/storage/policy
     */
    putStoragePolicy: (
      data: UpdateStoragePolicyInput,
      params: RequestParams = {},
    ) =>
      this.request<StorageOverview, PutStoragePolicyError>({
        path: `/api/storage/policy`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  net = {
    /**
     * No description
     *
     * @tags Network
     * @name GetNetRoutes
     * @request GET:/api/net/routes
     */
    getNetRoutes: (params: RequestParams = {}) =>
      this.request<NetRouteList, GetNetRoutesError>({
        path: `/api/net/routes`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name PostNetRoute
     * @request POST:/api/net/routes
     */
    postNetRoute: (data: CreateNetRouteInput, params: RequestParams = {}) =>
      this.request<NetRoute, PostNetRouteError>({
        path: `/api/net/routes`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name PatchNetRoute
     * @request PATCH:/api/net/routes/{id}
     */
    patchNetRoute: (
      id: string,
      data: UpdateNetRouteInput,
      params: RequestParams = {},
    ) =>
      this.request<NetRoute, PatchNetRouteError>({
        path: `/api/net/routes/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name DeleteNetRoute
     * @request DELETE:/api/net/routes/{id}
     */
    deleteNetRoute: (id: string, params: RequestParams = {}) =>
      this.request<MessageResponse, DeleteNetRouteError>({
        path: `/api/net/routes/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name PutNetRouteOrder
     * @request PUT:/api/net/routes/order
     */
    putNetRouteOrder: (data: NetRouteOrderInput, params: RequestParams = {}) =>
      this.request<NetRouteList, PutNetRouteOrderError>({
        path: `/api/net/routes/order`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name GetNetDnsProviders
     * @request GET:/api/net/dns-providers
     */
    getNetDnsProviders: (params: RequestParams = {}) =>
      this.request<DnsProviderList, GetNetDnsProvidersError>({
        path: `/api/net/dns-providers`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name GetNetCheck
     * @request GET:/api/net/check
     */
    getNetCheck: (params: RequestParams = {}) =>
      this.request<NetCheckState, GetNetCheckError>({
        path: `/api/net/check`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Network
     * @name PostNetCheck
     * @request POST:/api/net/check
     */
    postNetCheck: (data: StartNetCheckInput, params: RequestParams = {}) =>
      this.request<NetCheckState, PostNetCheckError>({
        path: `/api/net/check`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  settings = {
    /**
     * No description
     *
     * @tags Settings
     * @name GetMetadataSettings
     * @request GET:/api/settings/metadata
     */
    getMetadataSettings: (params: RequestParams = {}) =>
      this.request<MetadataSettings, GetMetadataSettingsError>({
        path: `/api/settings/metadata`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name PutMetadataSettings
     * @request PUT:/api/settings/metadata
     */
    putMetadataSettings: (
      data: UpdateMetadataSettingsInput,
      params: RequestParams = {},
    ) =>
      this.request<MetadataSettings, PutMetadataSettingsError>({
        path: `/api/settings/metadata`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name PostMetadataCheck
     * @request POST:/api/settings/metadata/check
     */
    postMetadataCheck: (
      data: CheckMetadataKeyInput,
      params: RequestParams = {},
    ) =>
      this.request<MetadataKeyCheck, PostMetadataCheckError>({
        path: `/api/settings/metadata/check`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name PutImdbSettings
     * @request PUT:/api/settings/metadata/imdb
     */
    putImdbSettings: (
      data: UpdateImdbSettingsInput,
      params: RequestParams = {},
    ) =>
      this.request<ImdbDatasetStatus, PutImdbSettingsError>({
        path: `/api/settings/metadata/imdb`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name PostImdbRefresh
     * @request POST:/api/settings/metadata/imdb/refresh
     */
    postImdbRefresh: (params: RequestParams = {}) =>
      this.request<ImdbDatasetStatus, PostImdbRefreshError>({
        path: `/api/settings/metadata/imdb/refresh`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name GetPlaybackSettings
     * @request GET:/api/settings/playback
     */
    getPlaybackSettings: (params: RequestParams = {}) =>
      this.request<PlaybackSettings, GetPlaybackSettingsError>({
        path: `/api/settings/playback`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name PutPlaybackSettings
     * @request PUT:/api/settings/playback
     */
    putPlaybackSettings: (
      data: UpdatePlaybackSettingsInput,
      params: RequestParams = {},
    ) =>
      this.request<PlaybackSettings, PutPlaybackSettingsError>({
        path: `/api/settings/playback`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Settings
     * @name PostPlaybackCheck
     * @request POST:/api/settings/playback/check
     */
    postPlaybackCheck: (params: RequestParams = {}) =>
      this.request<PlaybackSettings, PostPlaybackCheckError>({
        path: `/api/settings/playback/check`,
        method: "POST",
        format: "json",
        ...params,
      }),
  };
  setup = {
    /**
     * No description
     *
     * @tags Setup
     * @name GetSetupWizard
     * @request GET:/api/setup/wizard
     */
    getSetupWizard: (params: RequestParams = {}) =>
      this.request<WizardState, GetSetupWizardError>({
        path: `/api/setup/wizard`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Setup
     * @name PutSetupWizard
     * @request PUT:/api/setup/wizard
     */
    putSetupWizard: (data: UpdateWizardInput, params: RequestParams = {}) =>
      this.request<WizardState, PutSetupWizardError>({
        path: `/api/setup/wizard`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Setup
     * @name GetSetupStorageCheck
     * @request GET:/api/setup/storage-check
     */
    getSetupStorageCheck: (params: RequestParams = {}) =>
      this.request<StorageCheck, GetSetupStorageCheckError>({
        path: `/api/setup/storage-check`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Setup
     * @name PostSetupDiscoverManagers
     * @request POST:/api/setup/discover-managers
     */
    postSetupDiscoverManagers: (params: RequestParams = {}) =>
      this.request<DiscoverManagersResult, PostSetupDiscoverManagersError>({
        path: `/api/setup/discover-managers`,
        method: "POST",
        format: "json",
        ...params,
      }),
  };
  playback = {
    /**
     * No description
     *
     * @tags Playback
     * @name PostPlayback
     * @request POST:/api/playback
     */
    postPlayback: (data: CreatePlaybackInput, params: RequestParams = {}) =>
      this.request<Playback, PostPlaybackError>({
        path: `/api/playback`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Playback
     * @name GetPlayback
     * @request GET:/api/playback/{id}
     */
    getPlayback: (id: string, params: RequestParams = {}) =>
      this.request<Playback, GetPlaybackError>({
        path: `/api/playback/${id}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Playback
     * @name DeletePlayback
     * @request DELETE:/api/playback/{id}
     */
    deletePlayback: (id: string, params: RequestParams = {}) =>
      this.request<MessageResponse, DeletePlaybackError>({
        path: `/api/playback/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Playback
     * @name GetPlaybackSubtitles
     * @request GET:/api/playback/{id}/subtitles/{trackId}
     */
    getPlaybackSubtitles: (
      id: string,
      trackId: string,
      query?: {
        /** @pattern ^\d{1,7}(?:\.\d+)?$ */
        from?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<SubtitleCues, GetPlaybackSubtitlesError>({
        path: `/api/playback/${id}/subtitles/${trackId}`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
  watchState = {
    /**
     * No description
     *
     * @tags Playback
     * @name PutWatchState
     * @request PUT:/api/watch-state
     */
    putWatchState: (data: UpdateWatchStateInput, params: RequestParams = {}) =>
      this.request<WatchState, PutWatchStateError>({
        path: `/api/watch-state`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  profiles = {
    /**
     * No description
     *
     * @tags Profiles
     * @name GetProfiles
     * @request GET:/api/profiles
     */
    getProfiles: (params: RequestParams = {}) =>
      this.request<ProfileList, GetProfilesError>({
        path: `/api/profiles`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name PostProfile
     * @request POST:/api/profiles
     */
    postProfile: (data: CreateProfileInput, params: RequestParams = {}) =>
      this.request<Profile, PostProfileError>({
        path: `/api/profiles`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name PutCurrentPlayerSettings
     * @request PUT:/api/profiles/current/player
     */
    putCurrentPlayerSettings: (
      data: UpdatePlayerSettingsInput,
      params: RequestParams = {},
    ) =>
      this.request<PlayerSettings, PutCurrentPlayerSettingsError>({
        path: `/api/profiles/current/player`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name PatchProfile
     * @request PATCH:/api/profiles/{id}
     */
    patchProfile: (
      id: string,
      data: UpdateProfileInput,
      params: RequestParams = {},
    ) =>
      this.request<Profile, PatchProfileError>({
        path: `/api/profiles/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name DeleteProfile
     * @request DELETE:/api/profiles/{id}
     */
    deleteProfile: (
      id: string,
      query?: {
        /**
         * @minLength 1
         * @maxLength 100
         */
        moveTo?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<MessageResponse, DeleteProfileError>({
        path: `/api/profiles/${id}`,
        method: "DELETE",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name GetProfileHistory
     * @request GET:/api/profiles/{id}/history
     */
    getProfileHistory: (
      id: string,
      query?: {
        /**
         * @min 0
         * @max 9007199254740991
         * @default 0
         */
        offset?: number;
        /**
         * @min 1
         * @max 50
         * @default 50
         */
        limit?: number;
        /**
         * @default "en-US"
         * @pattern ^[a-z]{2}-[A-Z]{2}$
         */
        language?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<ProfileHistory, GetProfileHistoryError>({
        path: `/api/profiles/${id}/history`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name PutProfilePin
     * @request PUT:/api/profiles/{id}/pin
     */
    putProfilePin: (
      id: string,
      data: SetProfilePinInput,
      params: RequestParams = {},
    ) =>
      this.request<Profile, PutProfilePinError>({
        path: `/api/profiles/${id}/pin`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name DeleteProfilePin
     * @request DELETE:/api/profiles/{id}/pin
     */
    deleteProfilePin: (id: string, params: RequestParams = {}) =>
      this.request<Profile, DeleteProfilePinError>({
        path: `/api/profiles/${id}/pin`,
        method: "DELETE",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Profiles
     * @name PostProfileSelect
     * @request POST:/api/profiles/{id}/select
     */
    postProfileSelect: (
      id: string,
      data: SelectProfileInput,
      params: RequestParams = {},
    ) =>
      this.request<Profile, PostProfileSelectError>({
        path: `/api/profiles/${id}/select`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
  devices = {
    /**
     * No description
     *
     * @tags Devices
     * @name PostDevicePairing
     * @request POST:/api/devices/pairing
     */
    postDevicePairing: (data: StartPairingInput, params: RequestParams = {}) =>
      this.request<Pairing, PostDevicePairingError>({
        path: `/api/devices/pairing`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Devices
     * @name GetDevicePairing
     * @request GET:/api/devices/pairing/{secret}
     */
    getDevicePairing: (secret: string, params: RequestParams = {}) =>
      this.request<PairingStatus, GetDevicePairingError>({
        path: `/api/devices/pairing/${secret}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Devices
     * @name PostDevicePairingConfirm
     * @request POST:/api/devices/pairing/confirm
     */
    postDevicePairingConfirm: (
      data: ConfirmPairingInput,
      params: RequestParams = {},
    ) =>
      this.request<ConfirmedPairing, PostDevicePairingConfirmError>({
        path: `/api/devices/pairing/confirm`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Devices
     * @name GetDevices
     * @request GET:/api/devices
     */
    getDevices: (params: RequestParams = {}) =>
      this.request<DeviceList, GetDevicesError>({
        path: `/api/devices`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Devices
     * @name PatchDevice
     * @request PATCH:/api/devices/{id}
     */
    patchDevice: (
      id: string,
      data: UpdateDeviceInput,
      params: RequestParams = {},
    ) =>
      this.request<Device, PatchDeviceError>({
        path: `/api/devices/${id}`,
        method: "PATCH",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Devices
     * @name DeleteDevice
     * @request DELETE:/api/devices/{id}
     */
    deleteDevice: (id: string, params: RequestParams = {}) =>
      this.request<MessageResponse, DeleteDeviceError>({
        path: `/api/devices/${id}`,
        method: "DELETE",
        format: "json",
        ...params,
      }),
  };
  engine = {
    /**
     * No description
     *
     * @tags Torrents
     * @name RestartEngine
     * @request POST:/api/engine/restart
     */
    restartEngine: (params: RequestParams = {}) =>
      this.request<MessageResponse, RestartEngineError>({
        path: `/api/engine/restart`,
        method: "POST",
        format: "json",
        ...params,
      }),
  };
  logs = {
    /**
     * No description
     *
     * @tags Logs
     * @name GetLogs
     * @request GET:/api/logs
     */
    getLogs: (
      query?: {
        level?: "debug" | "info" | "warn" | "error";
        /** @pattern ^(?:server|engine|playback|storage|sources|catalog|network|notifications|auth)(?:,(?:server|engine|playback|storage|sources|catalog|network|notifications|auth))*$ */
        source?: string;
        /** @maxLength 200 */
        q?: string;
        /**
         * @min 0
         * @max 9007199254740991
         */
        before?: number;
        /**
         * @min 0
         * @max 9007199254740991
         */
        after?: number;
        /**
         * @min 1
         * @max 500
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<LogsResponse, GetLogsError>({
        path: `/api/logs`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Logs
     * @name PutLogLevel
     * @request PUT:/api/logs/level
     */
    putLogLevel: (data: LogLevelBodyInput, params: RequestParams = {}) =>
      this.request<LogLevelResponse, PutLogLevelError>({
        path: `/api/logs/level`,
        method: "PUT",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
}
