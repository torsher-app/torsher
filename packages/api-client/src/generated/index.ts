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
  about = {
    /**
     * No description
     *
     * @tags About
     * @name GetAbout
     * @request GET:/about/
     */
    getAbout: (params: RequestParams = {}) =>
      this.request<AboutResponse, any>({
        path: `/about/`,
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
     * @name PostAuthSignup
     * @request POST:/auth/signup
     */
    postAuthSignup: (data: SignupInput, params: RequestParams = {}) =>
      this.request<MessageResponse, PostAuthSignupError>({
        path: `/auth/signup`,
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
     * @request POST:/auth/signin
     */
    postAuthSignin: (data: SigninInput, params: RequestParams = {}) =>
      this.request<MessageResponse, PostAuthSigninError>({
        path: `/auth/signin`,
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
     * @request POST:/auth/refresh
     */
    postAuthRefresh: (params: RequestParams = {}) =>
      this.request<MessageResponse, PostAuthRefreshError>({
        path: `/auth/refresh`,
        method: "POST",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Auth
     * @name PostAuthLogout
     * @request POST:/auth/logout
     */
    postAuthLogout: (params: RequestParams = {}) =>
      this.request<MessageResponse, any>({
        path: `/auth/logout`,
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
     * @request GET:/users/me
     */
    getUsersMe: (params: RequestParams = {}) =>
      this.request<MeResponse, GetUsersMeError>({
        path: `/users/me`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags Users
     * @name PatchUsersMe
     * @request PATCH:/users/me
     */
    patchUsersMe: (data: UpdateMeInput, params: RequestParams = {}) =>
      this.request<MeResponse, PatchUsersMeError>({
        path: `/users/me`,
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
     * @request GET:/catalog/search
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
        path: `/catalog/search`,
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
     * @request GET:/catalog/titles/{id}
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
        path: `/catalog/titles/${id}`,
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
     * @request GET:/catalog/titles/{id}/seasons/{number}
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
        path: `/catalog/titles/${id}/seasons/${number}`,
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
     * @request GET:/catalog/titles/{id}/extras
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
        path: `/catalog/titles/${id}/extras`,
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
     * @request GET:/catalog/trending
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
        path: `/catalog/trending`,
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
     * @request GET:/home
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
        path: `/home`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),
  };
}
