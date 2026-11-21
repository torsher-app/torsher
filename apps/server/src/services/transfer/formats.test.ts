import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.ts'
import { buildZip } from './fixtures/zip.ts'
import {
  ImportFormatError,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseImportFiles,
} from './formats.ts'
import { looksLikeExport } from './document.ts'
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

  it('экспорт Letterboxd: оценки, watchlist и отметки из корня архива', () => {
    const zip = buildZip({
      'ratings.csv':
        'Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Paper Lanterns,2018,https://boxd.it/x,3.5\n2020-01-02,Half Star,2001,https://boxd.it/y,0.5\n',
      'watchlist.csv':
        'Date,Name,Year,Letterboxd URI\n2021-03-04,Moon Over Harbor,2011,https://boxd.it/z\n',
      'watched.csv':
        'Date,Name,Year,Letterboxd URI\n2020-01-01,Only Seen,2000,https://boxd.it/w\n',
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
      ['history', 'Only Seen', undefined, 'movie'],
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

describe('общий файл отметок тайтлов', () => {
  const entry = {
    list: 'watched',
    title: 'Synthetic Beacon',
    kind: 'series',
    year: 2020,
    tmdbId: 9901,
  }
  const document = (entries: unknown[], version: unknown = 1) =>
    JSON.stringify({ format: 'torsher-import', version, entries })
  const parse = (text: string) =>
    parseImportFiles([file('watched.json', text)])

  it('читает только title-level отметки и отличает их от native export и Trakt', () => {
    const text = document([
      entry,
      {
        list: 'watched',
        title: 'torsher-export',
        kind: 'movie',
        originalTitle: 'Synthetic Light',
        imdbId: 'tt9000001',
      },
    ])
    expect(looksLikeExport(text)).toBe(false)
    expect(parse(text)).toEqual({
      sources: ['torsher'],
      skipped: 0,
      entries: [
        { ...entry, source: 'torsher' },
        expect.objectContaining({
          kind: 'movie',
          source: 'torsher',
          list: 'watched',
        }),
      ],
    })
  })

  it('отклоняет неподдерживаемые версии, malformed и поля истории вместо ложного empty', () => {
    expect(formatError(() => parse(document([entry], 2)))).toBe('newerVersion')
    for (const version of [0, '1', null]) {
      expect(formatError(() => parse(document([entry], version)))).toBe(
        'broken',
      )
    }
    for (const invalid of [
      { ...entry, title: '  ' },
      { ...entry, kind: 'episode' },
      { ...entry, rating: 8 },
      { ...entry, at: '2020-01-01' },
      { ...entry, episode: 1 },
      { ...entry, tmdbId: -1 },
      { ...entry, list: 'watchlist' },
    ])
      expect(formatError(() => parse(document([invalid])))).toBe('broken')
    expect(formatError(() => parse('{"format":"torsher-import",'))).toBe(
      'broken',
    )
    expect(formatError(() => parse(document([])))).toBe('empty')
  })

  it('соблюдает общие пределы строк и байтов', () => {
    expect(
      parse(document(Array.from({ length: MAX_IMPORT_ROWS }).fill(entry)))
        .entries,
    ).toHaveLength(MAX_IMPORT_ROWS)
    expect(
      formatError(() =>
        parse(
          document(Array.from({ length: MAX_IMPORT_ROWS + 1 }).fill(entry)),
        ),
      ),
    ).toBe('tooMany')
    expect(
      formatError(() =>
        parseImportFiles([
          file('watched.json', Buffer.alloc(MAX_IMPORT_BYTES + 1)),
        ]),
      ),
    ).toBe('tooLarge')
  })
})

describe('viewing history adapters', () => {
  const header
    = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Note,Context,Watched Date'
  const row
    = '2024-06-15,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/,,Yes,Own note,Balcony,2024-06-14'

  it('preserves both identical diary rows on their watched day without using the film URI as a view ID', () => {
    const data = `${header}\n${row}\n${row}\n`
    const entries = parseImportFiles([file('diary.csv', data)]).entries
    const [first, second] = entries.map(entry => entry.viewing)
    expect(entries).toHaveLength(2)
    expect(first).toMatchObject({
      kind: 'entry',
      date: { precision: 'day', day: '2024-06-14', instant: null },
      rewatch: true,
      note: 'Own note',
      viewingContext: 'Balcony',
    })
    expect(first).not.toMatchObject({
      originKey: (second as { originKey: string }).originKey,
    })

    const annotated = data.replaceAll(
      'Own note,Balcony',
      'Corrected annotation,Living room',
    )
    const renamed = parseImportFiles([file('any-name.csv', annotated)]).entries
    expect(
      renamed.map(item => (item.viewing as { originKey: string }).originKey),
    ).toEqual(
      entries.map(item => (item.viewing as { originKey: string }).originKey),
    )
  })

  it('uses a verified event URI for review enrichment and ignores deleted copies', () => {
    const url
      = 'https://letterboxd.com/fictional-reviewer/film/paper-lanterns/2/'
    const diary = `${header}\n2024-06-15,Paper Lanterns,2018,${url},,Yes,,,2024-06-14\n`
    const reviews = 'Date,Name,Year,Letterboxd URI,Review,Watched Date'
    const archive = buildZip({
      'DIARY.CSV': diary,
      'reviews.csv': `${reviews}\n2024-06-15,Paper Lanterns,2018,${url},Attached review,2024-06-14\n`,
      'deleted/diary.csv': diary.replaceAll('Paper Lanterns', 'Deleted entry'),
      'deleted/reviews.csv': `${reviews}\n2024-06-15,Paper Lanterns,2018,${url},Deleted review,2024-06-14\n`,
      'orphaned/history-3.json': 'unreadable',
    })
    const parsed = parseImportFiles([file('archive.zip', archive)])
    expect(parsed.skipped).toBe(0)
    expect(parsed.entries).toEqual([
      expect.objectContaining({
        title: 'Paper Lanterns',
        viewing: expect.objectContaining({
          originKey: expect.stringMatching(/^uri:/),
          note: 'Attached review',
        }),
      }),
    ])
  })

  it('reports an ambiguous review without attaching it to either same-day viewing', () => {
    const diary = `${header}\n${row.replace('Own note', '')}\n${row.replace('Own note', '')}\n`
    const review
      = 'Date,Name,Year,Letterboxd URI,Review,Watched Date\n'
        + '2024-06-15,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/,Ambiguous review,2024-06-14\n'
    const parsed = parseImportFiles([
      file('diary.csv', diary),
      file('reviews.csv', review),
    ])
    expect(parsed.skipped).toBe(1)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries.map(entry => entry.viewing)).toEqual([
      expect.objectContaining({ note: null }),
      expect.objectContaining({ note: null }),
    ])
  })

  it('retains adjacent unsafe Trakt history IDs, special episode coordinates and absent dates', () => {
    const sameTime
      = '"watched_at":"2026-04-01T10:15:00Z","type":"movie","movie":{"title":"Example","ids":{"tmdb":9901}}'
    const episode
      = '{"id":9223372036854775807,"type":"episode","watched_at":null,"episode":{"season":0,"number":2,"ids":{"tmdb":9950}},"show":{"title":"Quiet Ward","ids":{"tmdb":9902}}}'
    const archive = buildZip({
      'Export/WATCHED-HISTORY-2.JSON': `[{"id":9007199254740992,${sameTime}},{"id":9007199254740993,${sameTime}},${episode}]`,
      'deleted/history-2.json': 'broken',
      'Export/lists/history-3.json': 'broken',
      'watched-shows.json':
        '[{"type":"show","show":{"title":"Quiet Ward","ids":{"tmdb":9902}},"plays":15,"last_watched_at":"2026-04-01T10:15:00Z"}]',
    })
    const parsed = parseImportFiles([file('archive.zip', archive)])
    expect(parsed.skipped).toBe(0)
    expect(parsed.entries).toEqual([
      expect.objectContaining({
        viewing: expect.objectContaining({
          originKey: 'id:9007199254740992',
          date: {
            precision: 'instant',
            instant: '2026-04-01T10:15:00.000Z',
            day: null,
          },
        }),
      }),
      expect.objectContaining({
        viewing: expect.objectContaining({ originKey: 'id:9007199254740993' }),
      }),
      expect.objectContaining({
        kind: 'series',
        tmdbId: 9902,
        viewing: expect.objectContaining({
          originKey: 'id:9223372036854775807',
          season: 0,
          episode: 2,
          date: { precision: 'unknown', day: null, instant: null },
        }),
      }),
      expect.objectContaining({
        tmdbId: 9902,
        viewing: { kind: 'seen', season: 0, episode: 0 },
      }),
    ])
  })

  it('reports oversized annotations and invalid known viewing days', () => {
    const invalid = row.replace('2024-06-14', '2024-02-30')
    const large = row.replace('Own note', 'x'.repeat(10_001))
    const parsed = parseImportFiles([
      file('diary.csv', `${header}\n${row}\n${invalid}\n${large}\n`),
    ])
    expect(parsed.skipped).toBe(2)
    expect(parsed.entries).toHaveLength(1)
  })
})

it('uses Trakt viewing evidence before the file name and rejects shape-free history rows', () => {
  const movie = { title: 'Synthetic movie', ids: { tmdb: 9905 } }
  const current = parseImportFiles([
    file(
      'watchlist.json',
      JSON.stringify([{ type: 'movie', movie, id: 29, watched_at: null }]),
    ),
    file('history.json', JSON.stringify([{ type: 'movie', movie }])),
  ])
  expect(current.skipped).toBe(1)
  expect(current.entries).toEqual([
    expect.objectContaining({
      list: 'history',
      viewing: expect.objectContaining({
        originKey: 'id:29',
        date: { precision: 'unknown', instant: null, day: null },
      }),
    }),
  ])
})

describe('letterboxd review enrichment', () => {
  const url
    = 'https://letterboxd.com/fictional-reviewer/film/paper-lanterns/2/'
  const prefix = `2024-06-15,Paper Lanterns,2018,${url}`
  const reviewHeader = 'Date,Name,Year,Letterboxd URI,Review,Watched Date'
  const diaryHeader = 'Date,Name,Year,Letterboxd URI,Note,Watched Date'
  const viewDay = '2024-06-14'

  it('preserves both owned texts without repeating the same review', () => {
    const diary = `${diaryHeader.replace('Note,', 'Note,Review,')}\n${prefix},Diary note,Same review,${viewDay}\n`
    const review = `${reviewHeader}\n${prefix},Same review,${viewDay}\n`
    const parsed = parseImportFiles([
      file('diary.csv', diary),
      file('reviews (1).csv', review),
    ])
    expect(parsed.skipped).toBe(0)
    expect(parsed.entries).toEqual([
      expect.objectContaining({
        viewing: expect.objectContaining({
          note: 'Diary note\n\n---\n\nSame review',
        }),
      }),
    ])

    const separate = parseImportFiles([
      file(
        'diary.csv',
        `${diaryHeader}\n${prefix},Own diary note,${viewDay}\n`,
      ),
      file('reviews.csv', review),
    ])
    expect(separate.skipped).toBe(0)
    expect(separate.entries[0]?.viewing).toMatchObject({
      note: 'Own diary note\n\n---\n\nSame review',
    })
  })

  it('reports enrichment overflow and retains the original note without truncation', () => {
    const note = 'n'.repeat(7000)
    const review = 'r'.repeat(4000)
    const parsed = parseImportFiles([
      file('diary.csv', `${diaryHeader}\n${prefix},${note},${viewDay}\n`),
      file('reviews.csv', `${reviewHeader}\n${prefix},${review},${viewDay}\n`),
    ])
    expect(parsed.skipped).toBe(1)
    expect(parsed.entries[0]?.viewing).toMatchObject({ note })
  })

  it('treats a renamed review shape as enrichment and still recognises a renamed real diary', () => {
    const review = `${reviewHeader}\n${prefix},Review body,${viewDay}\n`
    expect(
      formatError(() => parseImportFiles([file('reviews (1).csv', review)])),
    ).toBe('empty')
    const diary
      = 'Date,Name,Year,Letterboxd URI,Rewatch,Watched Date\n'
        + `2024-06-15,Another film,2018,https://letterboxd.com/film/another-film/,Yes,${viewDay}\n`
    const parsed = parseImportFiles([
      file('arbitrary-name.csv', review),
      file('copied.csv', diary),
    ])
    expect(parsed.skipped).toBe(1)
    expect(parsed.entries).toEqual([
      expect.objectContaining({
        title: 'Another film',
        viewing: expect.objectContaining({
          kind: 'entry',
          note: null,
          rewatch: true,
        }),
      }),
    ])
  })
})

it('assigns fallback ordinals in numbered archive page order', () => {
  const row = {
    type: 'movie',
    movie: { title: 'Example', ids: { tmdb: 9901 } },
    watched_at: '2026-04-01T10:15:00Z',
  }
  const archive = buildZip({
    'Export/history-10.json': JSON.stringify([{ ...row, note: 'Page ten' }]),
    'Export/history-2.json': JSON.stringify([{ ...row, note: 'Page two' }]),
  })
  const parsed = parseImportFiles([file('archive.zip', archive)])
  expect(parsed.entries.map(item => item.viewing)).toEqual([
    expect.objectContaining({
      note: 'Page two',
      originKey: expect.stringMatching(/:1$/),
    }),
    expect.objectContaining({
      note: 'Page ten',
      originKey: expect.stringMatching(/:2$/),
    }),
  ])
})

it('treats the canonical Letterboxd diary with a Review column as viewing evidence', () => {
  const diary
    = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n'
      + '2024-06-15,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/,3.5,Yes,Own review,Balcony,2024-06-14\n'
  const evidence = [
    expect.objectContaining({
      list: 'history',
      viewing: expect.objectContaining({
        kind: 'entry',
        note: 'Own review',
        viewingContext: 'Balcony',
        rewatch: true,
        date: { precision: 'day', day: '2024-06-14', instant: null },
      }),
    }),
    expect.objectContaining({ list: 'rating', rating: 7 }),
  ]
  expect(parseImportFiles([file('diary.csv', diary)]).entries).toEqual(
    evidence,
  )

  const archive = buildZip({
    'letterboxd-export/DIARY.CSV': diary,
    'letterboxd-export/watched.csv':
      'Date,Name,Year,Letterboxd URI\n'
      + '2024-06-15,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/\n',
  })
  const parsed = parseImportFiles([file('archive.zip', archive)])
  expect(parsed.skipped).toBe(0)
  expect(parsed.entries).toEqual([
    ...evidence,
    expect.objectContaining({
      list: 'history',
      viewing: { kind: 'seen', season: 0, episode: 0 },
    }),
  ])
})
