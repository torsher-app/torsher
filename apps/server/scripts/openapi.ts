/**
 * Выгружает OpenAPI-спеку в openapi.json.
 *
 * Приложение поднимается в памяти, поэтому спеку можно получить
 * без запущенного сервера и без базы — клиентский codegen
 * не зависит от работающего окружения.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createApp } from '../src/app.ts'

const OUTPUT = join(import.meta.dirname, '..', 'openapi.json')

const app = createApp()

await app.ready()
await writeFile(OUTPUT, `${JSON.stringify(app.swagger(), null, 2)}\n`)
await app.close()

console.log(`OpenAPI-спека записана: ${OUTPUT}`)
