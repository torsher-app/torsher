// Список npm-зависимостей сервера с лицензиями для /usr/share/licenses в
// образе. Читает `pnpm licenses list --prod --json` со stdin: в нём есть
// абсолютные пути сборки, которым в образе не место. Тексты лицензий лежат
// в каталоге каждого пакета в /app/server/node_modules
import process from 'node:process'
import { text } from 'node:stream/consumers'

interface Entry {
  name: string
  versions: string[]
  homepage?: string
}

function format(byLicense: Record<string, Entry[]>) {
  const lines = Object.entries(byLicense)
    .flatMap(([license, entries]) =>
      entries.map(({ name, versions, homepage }) =>
        [`${name}@${versions.join(', ')}`, license, homepage ?? '']
          .join('\t')
          .trimEnd(),
      ),
    )
    .sort()

  return `Server dependencies (name@version, license, homepage)\n\n${lines.join('\n')}\n`
}

// Асинхронно: stdin-канал в неблокирующем режиме, и синхронное чтение
// падает с EAGAIN, если pnpm ещё не успел ничего написать
text(process.stdin).then((input) => {
  process.stdout.write(format(JSON.parse(input) as Record<string, Entry[]>))
})
