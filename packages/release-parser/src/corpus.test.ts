import { describe, expect, it } from 'vitest'
import {
  loadCorpus,
  measure,
  TARGET,
  TARGET_FIELDS,
} from '../scripts/corpus.ts'
import { parseRelease } from './parse.ts'

const files = loadCorpus()

describe('корпус', () => {
  it('каждый кейс размечает целевые поля', () => {
    for (const file of files) {
      for (const item of file.cases) {
        expect(typeof item.title, file.name).toBe('string')
        for (const field of TARGET_FIELDS) {
          expect(item.expected, `${file.name}: ${item.title}`).toHaveProperty(
            field,
          )
        }
      }
    }
  })

  it('не меньше 300 кейсов', () => {
    expect(
      files.reduce((sum, file) => sum + file.cases.length, 0),
    ).toBeGreaterThanOrEqual(300)
  })

  it.each(TARGET_FIELDS)(`точность %s не ниже ${TARGET * 100}%`, (field) => {
    const stat = measure(files).get(field)!
    expect(stat.correct / stat.total).toBeGreaterThanOrEqual(TARGET)
  })
})

// Полный результат разбора всего корпуса, строка на кейс: ловит регрессии и в полях без разметки
describe('snapshot корпуса', () => {
  it.each(files.map(file => [file.name, file] as const))(
    '%s',
    async (name, file) => {
      const lines = file.cases.map(({ title }) =>
        JSON.stringify(parseRelease(title)),
      )
      await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(
        `../corpus/__snapshots__/${name.replace(/\.json$/, '.jsonl')}`,
      )
    },
  )
})
