import { defineConfig } from '@torsher/eslint-config'

export default defineConfig(
  {
    vue: true,
    typescript: true,
  },
  {
    // Промежуточные файлы и отчёты сборки Gradle
    ignores: [
      'apps/tv-shell-android/**/build/**',
      'apps/tv-shell-android/.gradle/**',
      'apps/tv-shell-android/.kotlin/**',
    ],
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
