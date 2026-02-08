import type { CiRunnerConfig } from '@number10/ci-runner-cli/types'

const config = {
  cwd: '.',
  output: {
    format: 'pretty',
    verbose: false,
  },
  steps: [
    {
      id: 'clean',
      name: 'Clean',
      command: 'pnpm run clean',
      optional: true,
      enabled: true, // Enabled by default, but can be disabled with env var for faster iteration when cleaning is not needed
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
} satisfies CiRunnerConfig

export default config
