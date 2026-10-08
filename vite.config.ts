import { defineConfig } from 'vite-plus'

const TYPE_GRAPH_FIXTURE_IGNORE = 'packages/typert/generator/tests/fixtures/type-model/**'
const stagedLintProfile = process.env.DSH_LINT_PROFILE === 'staged'
const lintIgnorePatterns = [
  '**/lib/**',
  '**/node_modules/**',
  '**/.sessions/**',
  '.claude/**',
  '**/.doc-typecheck-*/**',
  '**/.node-next-types-*/**',
  TYPE_GRAPH_FIXTURE_IGNORE,
  'vendor/**',
  'packages/experimental/claude-code-mods/examples/*/{hooks,tests,types}/**',
  'native/**',
  '**/*.js',
  '**/*.mjs',
  '**/*.config.ts',
  'packages/client/tsdown.client.ts',
]

export default defineConfig({
  test: {
    clearMocks: false,
  },
  fmt: {
    ignorePatterns: [
      '**/*.md',
      '.agents/notes/archived/**',
      'vendor/**',
      '**/fixtures/**',
      '**/lib/**',
      '**/dist/**',
      'packages/workflow/workflow-ptc/src/guest-source.ts',
      'packages/extensions/cordis-client-runner/src/client/api-catalog.ts',
      'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
      'packages/extensions/tool-cordis/src/api-catalog.ts',
    ],
    singleQuote: true,
    semi: false,
    tabWidth: 2,
    printWidth: 140,
    trailingComma: 'all',
    arrowParens: 'always',
  },
  lint: {
    plugins: [],
    categories: {
      correctness: 'off',
    },
    options: {
      reportUnusedDisableDirectives: 'warn',
      typeAware: !stagedLintProfile,
      // tsc -b in the face-specific projects owns compiler diagnostics.
      typeCheck: false,
    },
    env: {
      builtin: true,
    },
    ignorePatterns: stagedLintProfile ? lintIgnorePatterns.filter((pattern) => pattern !== TYPE_GRAPH_FIXTURE_IGNORE) : lintIgnorePatterns,
    overrides: [
      {
        files: [
          'packages/*/*/src/**/*.{ts,tsx}',
          'packages/*/*/tests/**/*.{ts,tsx}',
          'apps/*/src/**/*.{ts,tsx}',
          'apps/*/tests/**/*.{ts,tsx}',
          'examples/**/*.{ts,tsx}',
          'scripts/**/*.{ts,tsx}',
        ],
        rules: {
          'no-var': 'error',
          'prefer-const': 'error',
          'prefer-rest-params': 'error',
          'prefer-spread': 'error',
          'no-array-constructor': 'error',
          'no-unused-expressions': 'error',
          'no-unused-vars': [
            'error',
            {
              argsIgnorePattern: '^_',
              varsIgnorePattern: '^_',
              caughtErrorsIgnorePattern: '^_',
            },
          ],
          'no-useless-constructor': 'error',
          'no-restricted-properties': [
            'error',
            {
              object: 'crypto',
              property: 'randomUUID',
              message:
                'browsers withhold crypto.randomUUID outside secure contexts (plain-HTTP LAN pages); mint through @deepseek-ai/dsh-util-crypto instead',
            },
          ],
          'typescript/await-thenable': 'error',
          'typescript/ban-ts-comment': [
            'error',
            {
              minimumDescriptionLength: 10,
            },
          ],
          'typescript/no-array-delete': 'error',
          'typescript/no-base-to-string': 'error',
          'typescript/no-confusing-void-expression': 'error',
          'typescript/no-deprecated': 'error',
          'typescript/no-duplicate-enum-values': 'error',
          'typescript/no-duplicate-type-constituents': 'error',
          'typescript/no-dynamic-delete': 'error',
          'typescript/no-empty-object-type': 'off',
          'typescript/no-explicit-any': 'error',
          'typescript/no-extra-non-null-assertion': 'error',
          'typescript/no-extraneous-class': 'error',
          'typescript/no-floating-promises': 'error',
          'typescript/no-for-in-array': 'error',
          'typescript/no-implied-eval': 'error',
          'typescript/no-invalid-void-type': 'off',
          'typescript/no-meaningless-void-operator': 'error',
          'typescript/no-misused-new': 'error',
          'typescript/no-misused-promises': 'error',
          'typescript/no-misused-spread': 'error',
          'typescript/no-mixed-enums': 'error',
          'typescript/no-namespace': 'off',
          'typescript/no-non-null-asserted-nullish-coalescing': 'error',
          'typescript/no-non-null-asserted-optional-chain': 'error',
          'typescript/no-redundant-type-constituents': 'error',
          'typescript/no-require-imports': 'error',
          'typescript/no-this-alias': 'error',
          'typescript/no-unnecessary-boolean-literal-compare': 'error',
          'typescript/no-unnecessary-template-expression': 'error',
          'typescript/no-unnecessary-type-arguments': 'error',
          'typescript/no-unnecessary-type-assertion': 'error',
          'typescript/no-unnecessary-type-constraint': 'error',
          'typescript/no-unnecessary-type-conversion': 'error',
          'typescript/no-unnecessary-type-parameters': 'error',
          'typescript/no-unsafe-argument': 'error',
          'typescript/no-unsafe-assignment': 'error',
          'typescript/no-unsafe-call': 'error',
          'typescript/no-unsafe-declaration-merging': 'error',
          'typescript/no-unsafe-enum-comparison': 'error',
          'typescript/no-unsafe-function-type': 'error',
          'typescript/no-unsafe-member-access': 'error',
          'typescript/no-unsafe-return': 'error',
          'typescript/no-unsafe-unary-minus': 'error',
          'typescript/no-useless-default-assignment': 'error',
          'typescript/no-wrapper-object-types': 'error',
          'typescript/prefer-as-const': 'error',
          'typescript/prefer-literal-enum-member': 'error',
          'typescript/prefer-namespace-keyword': 'error',
          'typescript/prefer-promise-reject-errors': 'error',
          'typescript/prefer-reduce-type-parameter': 'error',
          'typescript/prefer-return-this-type': 'error',
          'typescript/related-getter-setter-pairs': 'error',
          'typescript/restrict-plus-operands': [
            'error',
            {
              allowAny: false,
              allowBoolean: false,
              allowNullish: false,
              allowNumberAndString: false,
              allowRegExp: false,
            },
          ],
          'typescript/return-await': ['error', 'error-handling-correctness-only'],
          'typescript/triple-slash-reference': 'error',
          'typescript/unbound-method': 'error',
          'typescript/unified-signatures': 'error',
          'typescript/use-unknown-in-catch-callback-variable': 'error',
          'no-void': 'off',
        },
        plugins: ['typescript'],
      },
      {
        files: ['packages/*/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'],
        rules: {
          'typescript/no-non-null-assertion': 'error',
          'typescript/no-unnecessary-condition': [
            'error',
            {
              allowConstantLoopConditions: true,
            },
          ],
          'typescript/only-throw-error': 'error',
          'typescript/require-await': 'error',
          'typescript/restrict-template-expressions': [
            'error',
            {
              allowNumber: true,
              allowBoolean: true,
            },
          ],
          'typescript/switch-exhaustiveness-check': [
            'error',
            {
              considerDefaultExhaustiveForUnions: true,
            },
          ],
        },
        plugins: ['typescript'],
      },
      {
        files: ['examples/**/*.ts'],
        rules: {
          'typescript/require-await': 'off',
        },
        plugins: ['typescript'],
      },
      {
        files: [
          'packages/*/*/tests/**/*.{ts,tsx}',
          'apps/*/tests/**/*.{ts,tsx}',
          'examples/*/tests/**/*.{ts,tsx}',
          'scripts/**/*.spec.{ts,tsx}',
        ],
        rules: {
          'typescript/no-deprecated': [
            'error',
            {
              allow: [
                {
                  from: 'file',
                  name: ['snapshotEvents', 'eventAt', 'ownEvents'],
                  path: 'packages/core/session/src/index.ts',
                },
              ],
            },
          ],
          'typescript/no-invalid-void-type': 'error',
          'typescript/no-non-null-assertion': 'off',
          'typescript/no-unnecessary-condition': 'off',
          'typescript/only-throw-error': 'off',
          'typescript/require-await': 'off',
          'typescript/restrict-template-expressions': 'off',
        },
        plugins: ['typescript'],
      },
      {
        files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'],
        rules: {
          'sonarjs/duplicates-in-character-class': 'error',
          'sonarjs/no-all-duplicated-branches': 'error',
          'sonarjs/no-duplicate-in-composite': 'error',
          'sonarjs/no-duplicate-test-title': 'error',
          'sonarjs/no-identical-conditions': 'error',
          'sonarjs/no-identical-expressions': 'error',
          'sonarjs/no-identical-functions': 'error',
          'sonarjs/no-duplicated-branches': 'error',
        },
        jsPlugins: ['eslint-plugin-sonarjs'],
      },
      {
        files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'],
        rules: {
          '@stylistic/semi': ['error', 'never'],
          '@stylistic/quotes': [
            'error',
            'single',
            {
              avoidEscape: true,
            },
          ],
          '@stylistic/comma-dangle': ['error', 'always-multiline'],
          '@stylistic/eol-last': ['error', 'always'],
          '@stylistic/no-trailing-spaces': 'error',
          '@stylistic/object-curly-spacing': ['error', 'always'],
          '@stylistic/member-delimiter-style': [
            'error',
            {
              multiline: {
                delimiter: 'none',
              },
              singleline: {
                delimiter: 'semi',
                requireLast: false,
              },
            },
          ],
          '@stylistic/max-len': [
            'error',
            {
              code: 140,
              ignoreUrls: true,
              ignoreStrings: true,
              ignoreTemplateLiterals: true,
            },
          ],
        },
        jsPlugins: ['@stylistic/eslint-plugin'],
      },
      {
        files: ['packages/typert/generator/tests/fixtures/type-model/**/*.{ts,tsx}'],
        rules: {
          'typescript/no-explicit-any': 'off',
        },
      },
      {
        files: ['packages/typert/generator/tests/fixtures/type-model/packages/host/src/models.ts'],
        rules: {},
      },
      {
        files: [
          'packages/experimental/webworker-runtime/src/node/**/*.ts',
          'packages/experimental/webworker-runtime/src/storage/memory.ts',
          'packages/experimental/webworker-runtime/src/module-system/module-loader.ts',
          'packages/experimental/webworker-runtime/src/transport/synthetic-http.ts',
        ],
        rules: {
          'typescript/require-await': 'off',
          'typescript/no-extraneous-class': 'off',
        },
        plugins: ['typescript'],
      },
    ],
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
  },
})
