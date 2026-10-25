declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** Порт API. По умолчанию 3001. */
      API_PORT?: string
      /** Адрес, на котором слушает API. По умолчанию 0.0.0.0. */
      API_HOST?: string
      /** Origin клиента — для CORS. В production без явного значения CORS выключен. */
      CLIENT_URL?: string
      /** Путь к файлу SQLite или `:memory:`. По умолчанию .data/torsher.db. */
      DATABASE_PATH?: string
      /** Секрет для подписи JWT. Обязателен; в production — не короче 32 символов. */
      SECRET_KEY?: string
      /** Доверенный обратный прокси для X-Forwarded-For: `true`, адреса или подсети через запятую. */
      TRUST_PROXY?: string
      /** Ключ шифрования секретов в базе. Без него — файл secret.key рядом с базой. */
      TORSHER_SECRET?: string
      /** Префикс имён cookie: <prefix>_access_token. По умолчанию torsher. */
      COOKIE_PREFIX?: string
      /** Свой API Read Access Token TMDB (v4). Важнее ключа приложения из образа. */
      TMDB_ACCESS_TOKEN?: string
      /** Email dev-пользователя для `pnpm seed`. */
      SEED_USER_EMAIL?: string
      /** Пароль dev-пользователя для `pnpm seed`. */
      SEED_USER_PASSWORD?: string
    }
  }
}

export {}
