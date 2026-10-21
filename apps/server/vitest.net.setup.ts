import { setNetTransport } from './src/services/net/index.ts'

// Отдельный файл после `vitest.setup.ts`: config читает часть env при загрузке.
// Тесты подменяют глобальный `fetch`, через него же идёт и `netFetch`;
// настоящие маршруты и прокси проверяет `src/services/net/index.test.ts`
setNetTransport((url, init) => globalThis.fetch(url, init))
