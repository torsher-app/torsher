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
  overview: string;
  genres: string[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  runtime?: number;
  rating?: number;
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

export interface TitleExtrasInput {
  cast: PersonInput[];
  similar: CardInput[];
  aka: string[];
  directors: string[];
}

export interface CatalogSearchResponseInput {
  items: CardInput[];
}

export interface CatalogTrendingResponseInput {
  items: CardInput[];
}

export interface HomeRowInput {
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
    | "topRatedSeries";
  kind: "top10" | "posters";
  title: string;
  items: CardInput[];
}

export interface HomeResponseInput {
  rows: HomeRowInput[];
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

export interface CreatePlaybackInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex: number;
}

export interface PlaybackInput {
  streamUrl: string;
  mode: "direct";
  title: string;
  fileName: string;
  size: number;
  duration: number | null;
  startPosition: number | null;
}

export interface UpdateWatchStateInput {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex: number;
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
}

export interface WatchStateInput {
  torrentId: string;
  fileIndex: number;
  position: number;
  duration: number | null;
  updatedAt: string;
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
}

export interface TorrentListInput {
  items: TorrentInput[];
  engine: "ready" | "not_installed" | "starting" | "stopped";
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
  activity: "idle" | "checking" | "downloading" | "paused" | "error";
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

export interface AboutResponse {
  version: string;
  commit?: string;
  license: string;
  /** @format uri */
  sourceUrl: string;
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
  overview: string;
  genres: string[];
  /**
   * @min -9007199254740991
   * @max 9007199254740991
   */
  runtime?: number;
  rating?: number;
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

export interface TitleExtras {
  cast: Person[];
  similar: Card[];
  aka: string[];
  directors: string[];
}

export interface CatalogSearchResponse {
  items: Card[];
}

export interface CatalogTrendingResponse {
  items: Card[];
}

export interface HomeRow {
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
    | "topRatedSeries";
  kind: "top10" | "posters";
  title: string;
  items: Card[];
}

export interface HomeResponse {
  rows: HomeRow[];
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

export interface CreatePlayback {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex: number;
}

export interface Playback {
  streamUrl: string;
  mode: "direct";
  title: string;
  fileName: string;
  size: number;
  duration: number | null;
  startPosition: number | null;
}

export interface UpdateWatchState {
  /**
   * @minLength 1
   * @maxLength 100
   */
  torrentId: string;
  /**
   * @min 0
   * @max 99999
   */
  fileIndex: number;
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
}

export interface WatchState {
  torrentId: string;
  fileIndex: number;
  position: number;
  duration: number | null;
  updatedAt: string;
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
}

export interface TorrentList {
  items: Torrent[];
  engine: "ready" | "not_installed" | "starting" | "stopped";
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
  activity: "idle" | "checking" | "downloading" | "paused" | "error";
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

export type PostAuthSignupError = MessageResponse;

export type PostAuthSigninError = MessageResponse;

export type PostAuthRefreshError = MessageResponse;

export type GetUsersMeError = MessageResponse;

export type PatchUsersMeError = MessageResponse;

export type GetCatalogSearchError = MessageResponse;

export type GetCatalogTitleError = MessageResponse;

export type GetCatalogSeasonError = MessageResponse;

export type GetCatalogTitleExtrasError = MessageResponse;

export type GetCatalogTrendingError = MessageResponse;

export type GetHomeError = MessageResponse;

export type GetIndexersError = MessageResponse;

export type PostIndexerError = MessageResponse | SourceErrorResponse;

export type PatchIndexerError = MessageResponse;

export type DeleteIndexerError = MessageResponse;

export type PostIndexerTestError = MessageResponse;

export type GetIndexerManagersError = MessageResponse;

export type PostIndexerManagerError = MessageResponse | SourceErrorResponse;

export type PostIndexerManagerSyncError = MessageResponse | SourceErrorResponse;

export type DeleteIndexerManagerError = MessageResponse;

export type GetTorrentsError = MessageResponse;

export type PostTorrentError = MessageResponse | EngineUnavailableResponse;

export type GetTorrentError = MessageResponse;

export type DeleteTorrentError = MessageResponse | EngineUnavailableResponse;

export type PostTorrentRetryError = MessageResponse | EngineUnavailableResponse;

export type GetTorrentStatsError = MessageResponse | EngineUnavailableResponse;

export type PostPlaybackError = MessageResponse | EngineUnavailableResponse;

export type PutWatchStateError = MessageResponse;

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
        mode?: "all" | "movies" | "series";
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
    deleteTorrent: (id: string, params: RequestParams = {}) =>
      this.request<MessageResponse, DeleteTorrentError>({
        path: `/api/torrents/${id}`,
        method: "DELETE",
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
}
