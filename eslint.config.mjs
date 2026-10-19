import { defineConfig } from '@torsher/eslint-config'

export default defineConfig(
  {
    vue: true,
    typescript: true,
  },
  {
    // Точка входа API: top-level await и лог старта здесь уместны
    files: ['apps/server/src/main.ts'],
    rules: {
      'antfu/no-top-level-await': 'off',
      'no-console': 'off',
    },
  },
)
