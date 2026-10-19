import antfu from '@antfu/eslint-config'

/**
 * Единый ESLint-конфиг монорепо. Приложения не заводят свой набор правил,
 * они лишь дополняют этот: `defineConfig({}, { rules: { ... } })`.
 */
export function defineConfig(options = {}, ...userConfigs) {
  return antfu(
    {
      formatters: {
        css: true,
      },
      ignores: [
        '**/generated/**',
        '**/.nuxt/**',
        '**/.output/**',
        '**/dist/**',
        '**/db/migrations/**',
      ],
      ...options,
    },
    {
      rules: {
        'import/order': 'off',
        'perfectionist/sort-imports': 'off',
        'ts/consistent-type-definitions': ['error', 'interface'],
      },
    },
    ...userConfigs,
  )
}
