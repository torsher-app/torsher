import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.ts'
import { buildZip } from './fixtures/zip.ts'
import { ImportFormatError, parseImportFiles } from './formats.ts'
import { readZip, ZipError } from './zip.ts'

function file(name: string, content: string | Buffer) {
  return {
    name,
    data: Buffer.isBuffer(content) ? content : Buffer.from(content),
  }
}

function formatError(run: () => unknown) {
  try {
    run()
  }
  catch (err) {
    if (err instanceof ImportFormatError)
      return err.kind
  }

  return undefined
}

// Синтетические строки: выдуманные названия и ID `tt9…`
const IMDB_RATINGS = `${String.fromCharCode(0xFEFF)}Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt9000001,8,2019-05-04,"Moon, Over Harbor",Moon Over Harbor,https://example.test/,Movie,7.1,101,2011,Drama,1200,2011-03-01,Someone
tt9000002,6,2021-01-02,Quiet Ward,Quiet Ward,https://example.test/,TV Mini Series,7.4,50,2020,Drama,800,2020-02-02,
tt9000003,9,2021-01-03,Quiet Ward: Pilot,,https://example.test/,TV Episode,7.0,50,2020,Drama,100,2020-02-02,
`

const IMDB_WATCHLIST = `Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated
1,tt9000004,2022-07-08,2022-07-08,,Paper Lanterns,,https://example.test/,Movie,6.9,95,2018,Drama,300,2018-01-01,,,
`

describe('parseCsv', () => {
  it('разбирает кавычки, переводы строк в поле, CRLF и точку с запятой', () => {
    expect(parseCsv('a;b\r\n"x;1";"line\nnext"\r\n"say ""hi""";\r\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'line\nnext'],
      ['say "hi"', ''],
    ])
  })
})

describe('readZip', () => {
  it('читает только принятые файлы', () => {
    const zip = buildZip({ 'ratings.csv': 'a,b', 'reviews.csv': 'c' })

    expect(
      readZip(zip, name => name === 'ratings.csv', 1024).map(entry => [
        entry.name,
        entry.data.toString(),
      ]),
    ).toEqual([['ratings.csv', 'a,b']])
  })

  it('отказывает, когда распакованное больше предела', () => {
    const zip = buildZip({ 'ratings.csv': 'x'.repeat(2048) })

    expect(() => readZip(zip, () => true, 1024)).toThrow()
  })

  it('смещения за пределами архива — ZipError, а не RangeError', () => {
    const zip = buildZip({ 'ratings.csv': 'a,b' })
    const eocd = zip.length - 22
    const directory = zip.readUInt32LE(eocd + 16)

    const farDirectory = Buffer.from(zip)

    farDirectory.writeUInt32LE(0xFFFFFF00, eocd + 16)
    expect(() => readZip(farDirectory, () => true, 1024)).toThrow(ZipError)

    const farEntry = Buffer.from(zip)

    farEntry.writeUInt32LE(0xFFFFFF00, directory + 42)
    expect(() => readZip(farEntry, () => true, 1024)).toThrow(ZipError)
    expect(() => parseImportFiles([file('export.zip', farEntry)])).toThrow(
      expect.objectContaining({ kind: 'broken' }),
    )
  })
})

describe('parseImportFiles', () => {
  it('экспорт IMDb: своя оценка с датой и вид; серии пропускаются; оценки IMDb не читаются', () => {
    const result = parseImportFiles([file('ratings.csv', IMDB_RATINGS)])

    expect(result.sources).toEqual(['imdb'])
    expect(result.skipped).toBe(1)
    expect(result.entries).toEqual([
      {
        source: 'imdb',
        list: 'rating',
        imdbId: 'tt9000001',
        title: 'Moon, Over Harbor',
        originalTitle: 'Moon Over Harbor',
        year: 2011,
        kind: 'movie',
        rating: 8,
        at: new Date('2019-05-04'),
      },
      expect.objectContaining({
        imdbId: 'tt9000002',
        kind: 'series',
        rating: 6,
      }),
    ])
  })

  it('экспорт IMDb: watchlist — «Позже» с датой добавления', () => {
    const [entry] = parseImportFiles([
      file('WATCHLIST.csv', IMDB_WATCHLIST),
    ]).entries

    expect(entry).toMatchObject({
      list: 'watchlist',
      imdbId: 'tt9000004',
      at: new Date('2022-07-08'),
    })
    expect(entry!.rating).toBeUndefined()
  })

  it('экспорт Letterboxd: из архива берутся только ratings.csv и watchlist.csv в корне, звёзды ×2', () => {
    const zip = buildZip({
      'ratings.csv':
        'Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Paper Lanterns,2018,https://boxd.it/x,3.5\n2020-01-02,Half Star,2001,https://boxd.it/y,0.5\n',
      'watchlist.csv':
        'Date,Name,Year,Letterboxd URI\n2021-03-04,Moon Over Harbor,2011,https://boxd.it/z\n',
      'watched.csv':
        'Date,Name,Year,Letterboxd URI\n2020-01-01,Ignored,2000,https://boxd.it/w\n',
      'deleted/ratings.csv':
        'Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Deleted,2000,https://boxd.it/d,5\n',
    })
    const { entries, sources } = parseImportFiles([
      file('letterboxd-export.zip', zip),
    ])

    expect(sources).toEqual(['letterboxd'])
    expect(
      entries.map(entry => [
        entry.list,
        entry.title,
        entry.rating,
        entry.kind,
      ]),
    ).toEqual([
      ['rating', 'Paper Lanterns', 7, 'movie'],
      ['rating', 'Half Star', 1, 'movie'],
      ['watchlist', 'Moon Over Harbor', undefined, 'movie'],
    ])
  })

  it('формат импорта Letterboxd: ID, Rating10 и дата просмотра', () => {
    const csv
      = 'Title,Year,imdbID,tmdbID,Rating10,WatchedDate\nЛунный берег,2011,tt9000001,,8,2019-05-04\nNo Ids,1999,,,4,\nBy Tmdb,2005,,555,,\n'
    const { entries, skipped } = parseImportFiles([file('converted.csv', csv)])

    expect(skipped).toBe(1)
    expect(entries).toEqual([
      expect.objectContaining({
        title: 'Лунный берег',
        imdbId: 'tt9000001',
        rating: 8,
        at: new Date('2019-05-04'),
      }),
      expect.objectContaining({ title: 'No Ids', year: 1999, rating: 4 }),
    ])
    expect(entries[0]!.kind).toBeUndefined()
  })

  it('экспорт Trakt: оценки и watchlist по TMDB ID с видом, серии пропускаются', () => {
    const zip = buildZip({
      'ratings-movies-1.json': JSON.stringify([
        {
          rated_at: '2023-02-03T10:00:00.000Z',
          rating: 9,
          type: 'movie',
          movie: {
            title: 'Paper Lanterns',
            year: 2018,
            ids: { trakt: 1, tmdb: 9001, imdb: 'tt9000004' },
          },
        },
      ]),
      'ratings-episodes.json': JSON.stringify([
        { rating: 7, type: 'episode', episode: {} },
      ]),
      'lists-watchlist.json': JSON.stringify([
        {
          listed_at: '2024-01-01T00:00:00.000Z',
          type: 'show',
          show: { title: 'Quiet Ward', year: 2020, ids: { tmdb: 9002 } },
        },
      ]),
      'history-1.json': '[]',
    })
    const { entries } = parseImportFiles([file('trakt.zip', zip)])

    expect(entries).toEqual([
      expect.objectContaining({
        source: 'trakt',
        list: 'rating',
        tmdbId: 9001,
        kind: 'movie',
        rating: 9,
      }),
      expect.objectContaining({
        list: 'watchlist',
        tmdbId: 9002,
        kind: 'series',
        at: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ])
  })

  it('незнакомый файл, битый JSON, пустой результат', () => {
    expect(
      formatError(() => parseImportFiles([file('x.csv', 'foo,bar\n1,2\n')])),
    ).toBe('unsupported')
    expect(formatError(() => parseImportFiles([file('x.json', '[{')]))).toBe(
      'broken',
    )
    expect(
      formatError(() =>
        parseImportFiles([
          file('watched.csv', 'Date,Name,Year,Letterboxd URI\n'),
        ]),
      ),
    ).toBe('empty')
  })
})
