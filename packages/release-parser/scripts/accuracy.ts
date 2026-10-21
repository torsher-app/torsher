import process from 'node:process'
import { parseArgs } from 'node:util'
import { loadCorpus, measure, TARGET, TARGET_FIELDS } from './corpus.ts'

const { values } = parseArgs({
  options: {
    errors: { type: 'string', default: '10' },
    field: { type: 'string' },
  },
})

const files = loadCorpus()
const stats = measure(files)
const cases = files.reduce((sum, file) => sum + file.cases.length, 0)
const limit = values.errors === 'all' ? Infinity : Number(values.errors)
const percent = (value: number) => `${(value * 100).toFixed(1)}%`

console.log(`Корпус: ${cases} кейсов в ${files.length} файлах\n`)
console.log('Поле        Точность   Верно / всего')
for (const [field, stat] of stats) {
  if (stat.total === 0)
    continue
  const target = (TARGET_FIELDS as readonly string[]).includes(field)
    ? ` (цель ${percent(TARGET)})`
    : ''
  console.log(
    `${field.padEnd(12)}${percent(stat.correct / stat.total).padStart(8)}   ${stat.correct} / ${stat.total}${target}`,
  )
}

for (const [field, stat] of stats) {
  if (stat.errors.length === 0 || (values.field && values.field !== field))
    continue
  console.log(`\nОшибки ${field}: ${stat.errors.length}`)
  for (const error of stat.errors.slice(0, limit)) {
    console.log(`  [${error.file}] ${error.title}`)
    console.log(`    ожидалось: ${JSON.stringify(error.expected)}`)
    console.log(`    получено:  ${JSON.stringify(error.actual)}`)
  }
}

const failed = TARGET_FIELDS.filter((field) => {
  const stat = stats.get(field)!
  return stat.correct / stat.total < TARGET
})
if (failed.length > 0) {
  console.log(`\nНиже цели: ${failed.join(', ')}`)
  process.exitCode = 1
}
