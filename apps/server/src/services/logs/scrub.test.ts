import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetScrub, scrubText } from './scrub.ts'

function line(fields: Record<string, unknown>) {
  return `${JSON.stringify({ level: 30, time: 1, ...fields })}\n`
}

beforeEach(() => {
  vi.stubEnv('DOWNLOADS_PATH', '/data/downloads')
  resetScrub()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetScrub()
})

describe('очистка записей журнала', () => {
  it('параметры адреса с секретами', () => {
    const text = line({
      url: '/api/stream/1/0?token=abc.def&x=1',
      msg: 'GET http://indexer.example/api?t=search&apikey=KEY123&q=dune passkey=no',
      other:
        'https://t.example/announce?passkey=PK&sig=S1&key=K2&password=P&access_token=A&refresh_token=R&api_key=Z',
    })
    const result = scrubText(text)

    for (const secret of [
      'abc.def',
      'KEY123',
      'PK',
      'S1',
      'K2',
      '=P&',
      '=A&',
      '=R&',
      '=Z"',
    ])
      expect(result).not.toContain(secret)
    expect(result).toContain('?token=[redacted]&x=1')
    expect(result).toContain('&apikey=[redacted]&q=dune')
    expect(JSON.parse(result).other).toContain('&api_key=[redacted]')
  })

  it('ключ в ссылке прокси Jackett', () => {
    const result = scrubText(
      line({
        msg: 'GET http://manager.example:9117/dl/indexer-a/?jackett_apikey=K1&path=P&file=F',
        amp: '/dl/indexer-a/?jackett_apikey=K2&amp;path=P',
      }),
    )

    expect(result).toContain('?jackett_apikey=[redacted]&path=P')
    expect(result).not.toMatch(/K[12]/)
  })

  it('учётные данные в адресе', () => {
    const result = scrubText(
      line({ msg: 'proxy socks5h://user:p%40ss@10.0.0.1:1080 failed' }),
    )

    expect(JSON.parse(result).msg).toBe(
      'proxy socks5h://[redacted]@10.0.0.1:1080 failed',
    )
  })

  it('заголовки авторизации без учёта регистра', () => {
    const result = scrubText(
      line({
        headers: {
          'Authorization': 'Bearer x',
          'cookie': 'a=b; c="d"',
          'Set-Cookie': ['s=1', 's=2'],
          'X-Api-Key': 'k',
          'accept': 'text/html',
        },
      }),
    )

    expect(JSON.parse(result).headers).toEqual({
      'Authorization': '[redacted]',
      'cookie': '[redacted]',
      'Set-Cookie': '[redacted]',
      'X-Api-Key': '[redacted]',
      'accept': 'text/html',
    })
  })

  it('путь внутри загрузок прячется до конца строки', () => {
    const result = JSON.parse(
      scrubText(
        line({
          msg: 'open /data/downloads/Some Movie (2008)/a.mkv: permission denied',
          path: '/data/downloads/Some Movie (2008)/a.mkv',
          dir: '/data/downloads',
          quoted: 'file "/data/downloads/x/y.mkv" missing',
          multi: 'a /data/downloads/x\nnext line',
        }),
      ),
    )

    expect(result.msg).toBe('open <downloads>/…')
    expect(result.path).toBe('<downloads>/…')
    expect(result.dir).toBe('<downloads>')
    expect(result.quoted).toBe('file "<downloads>/…" missing')
    expect(result.multi).toBe('a <downloads>/…\nnext line')
  })

  it('названия с кавычкой и двоеточием не просачиваются', () => {
    vi.stubEnv('DOWNLOADS_PATH', '/data/torrents')
    resetScrub()

    const result = JSON.parse(
      scrubText(
        line({
          quote: `open '/data/torrents/Schindler's List (1993)/movie.mkv'`,
          colon:
            'open /data/torrents/Star Wars: Episode IV (1977)/a.mkv: no such file',
          middle: 'read /data/torrents/Dune/a.mkv failed, retrying',
          windows: 'x /data/torrents/A\\B',
        }),
      ),
    )

    expect(result.quote).toBe(`open '<downloads>/…`)
    expect(result.colon).toBe('open <downloads>/…')
    expect(result.middle).toBe('read <downloads>/…')
    expect(result.windows).toBe('x <downloads>/…')
    expect(JSON.stringify(result)).not.toMatch(/List|Episode|Dune/)
  })

  it('относительный каталог загрузок ловится и в абсолютной форме', () => {
    vi.stubEnv('DOWNLOADS_PATH', '.data/downloads')
    resetScrub()

    const result = JSON.parse(
      scrubText(line({ msg: `open ${resolve('.data/downloads/T/x.mkv')}` })),
    )

    expect(result.msg).toBe('open <downloads>/…')
  })

  it('секреты в экранированных адресах', () => {
    const result = JSON.parse(
      scrubText(
        line({
          amp: '<a href="/x?a=1&amp;apikey=K1">',
          hash: '/play#token=K2',
          encoded: '/login?next=%2Fapi%3Fpasskey%3DK3%26sig%3dK4',
        }),
      ),
    )

    expect(result.amp).toBe('<a href="/x?a=1&amp;apikey=[redacted]">')
    expect(result.hash).toBe('/play#token=[redacted]')
    expect(result.encoded).toBe('/login?next=%2Fapi%3Fpasskey%3D[redacted]')
    expect(JSON.stringify(result)).not.toMatch(/K[1-4]/)
  })

  it('заголовок авторизации в тексте', () => {
    const result = JSON.parse(
      scrubText(
        line({
          bearer: 'sent Authorization: Bearer abc.def to indexer',
          basic: 'authorization:Basic dXNlcjpwYXNz',
          bare: 'AUTHORIZATION: raw-token',
        }),
      ),
    )

    expect(result.bearer).toBe('sent Authorization: [redacted] to indexer')
    expect(result.basic).toBe('authorization: [redacted]')
    expect(result.bare).toBe('AUTHORIZATION: [redacted]')
  })

  it('пути вне загрузок и обычный текст не меняются', () => {
    const text = line({
      msg: 'Engine is ready on http://127.0.0.1:4000',
      path: '/data/downloads2/x',
      other: '/data/transcodes/abc/seg.ts',
      url: '/api/torrents?page=2&tokens=1',
    })

    expect(scrubText(text)).toBe(text)
  })
})
