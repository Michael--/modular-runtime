import type { CiRunnerConfig } from '@number10/ci-runner-cli/types'

const config = {
  continueOnError: true,
  cwd: '.',
  env: {
    FORCE_COLOR: '1',
  },
  output: {
    format: 'pretty',
    verbose: false,
  },
  watch: {
    exclude: [
      '.temp',
      '.parcel-cache',
      '.husky',
      'node_modules',
      'dist',
      'build',
      'target',
      'generated',
      'bin/**',
      '*.mjs',
      'examples/**',
      'aggregate-results*.ndjson',
    ],
  },
  steps: [
    {
      id: 'prepare',
      name: 'CI Prepare',
      command: 'pnpm run ci:prepare',
    },
    {
      id: 'clean',
      name: 'Clean',
      command: 'pnpm run clean',
      optional: true,
      enabled: false, // Enabled by default, but can be disabled with env var for faster iteration when cleaning is not needed
    },
    {
      id: 'gen',
      name: 'Generate',
      command: 'pnpm run gen',
    },
    {
      id: 'build',
      name: 'Build',
      command: 'pnpm run build',
    },
    {
      id: 'typecheck',
      name: 'Typecheck',
      command: 'pnpm run typecheck',
    },
    {
      id: 'lint',
      name: 'Lint',
      command: 'pnpm run lint',
    },
    {
      id: 'integration-tests',
      name: 'Integration Tests',
      command: 'pnpm run test:integration',
      optional: true,
      when: {
        env: {
          RUN_INTEGRATION_TESTS: 'true',
        },
      },
    },
    {
      id: 'unit-tests',
      name: 'Unit Tests',
      command: 'pnpm run test',
    },
    {
      id: 'e2e-tests',
      name: 'E2E Tests',
      command: 'pnpm run test:e2e',
      optional: true,
    },
  ],
  targets: [
    {
      id: 'quick',
      name: 'Quick Checks',
      includeStepIds: ['typecheck', 'lint'],
    },
    {
      id: 'build',
      name: 'Build Only',
      includeStepIds: ['prepare', 'gen', 'build'],
    },
    {
      id: 'test',
      name: 'Tests Only',
      includeStepIds: ['unit-tests'],
    },
  ],
} satisfies CiRunnerConfig

export default config
