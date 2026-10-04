// Линтер всего репозитория: TypeScript со строгими типовыми правилами, правила хуков React
// и доступности JSX (WCAG 2.2 AA — CON-ADR-0001). Сгенерированное и сборки не проверяются.
import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'packages/api/src/control-plane.ts', '**/dist_keycloak/**', '**/keycloakify-dev-resources/**', 'apps/keycloak-theme/src/kc.gen.tsx', 'design-system/**', 'prototype/**', 'tools/**', '**/*.po'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    files: ['apps/web/**/*.tsx', 'apps/keycloak-theme/**/*.tsx', 'packages/ui/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // Тест паритета исполняет bundle.js дизайн-системы — там нужен доступ к его глобалам.
    files: ['**/tests/**'],
    // Тест паритета собирает обёртки компонентов на лету — для теста это нормально.
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'react-hooks/static-components': 'off' },
  },
)
