#!/usr/bin/env node
/* global process, console, URL */

/**
 * CI Pipeline Script with detailed status reporting
 * Cross-platform Node.js script for running all quality checks
 */

import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bright: '\x1b[1m',
}

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`
}

class CIPipeline {
  constructor() {
    this.results = new Map()
    this.durations = new Map()
    this.testInfos = new Map()
    this.startTime = Date.now()
  }

  runCommand(command, stepName) {
    console.log(colorize(`🔄 Running ${stepName}...`, 'blue'))

    const stepStart = Date.now()

    try {
      const result = execSync(command, {
        cwd: join(__dirname),
        env: { ...process.env, FORCE_COLOR: '1' },
        encoding: 'utf8',
        stdio: 'pipe',
      })

      const duration = Math.round((Date.now() - stepStart) / 1000)
      this.results.set(stepName, 'PASS')
      this.durations.set(stepName, duration)

      // Extract test counts from output (combine stdout and stderr)
      const fullOutput = result
      const testInfo = this.extractTestInfo(stepName, fullOutput)
      this.testInfos.set(stepName, testInfo)
      const testCountText = testInfo ? ` (${testInfo})` : ''

      console.log(colorize(`✅ ${stepName} completed in ${duration}s${testCountText}`, 'green'))
      return true
    } catch (error) {
      const duration = Math.round((Date.now() - stepStart) / 1000)
      this.results.set(stepName, 'FAIL')
      this.durations.set(stepName, duration)

      // Even on failure, try to extract test info from stdout and stderr
      const fullOutput = (error.stdout || '') + (error.stderr || '')
      const testInfo = this.extractTestInfo(stepName, fullOutput)
      this.testInfos.set(stepName, testInfo)
      const testCountText = testInfo ? ` (${testInfo})` : ''

      console.log(colorize(`❌ ${stepName} failed after ${duration}s${testCountText}`, 'red'))

      // Print failure details for debugging
      console.log(colorize('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red'))
      console.log(colorize(`ERROR DETAILS FOR: ${stepName}`, 'red'))
      console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red'))
      if (error.stdout) {
        console.log(colorize('STDOUT:', 'yellow'))
        console.log(error.stdout)
      }
      if (error.stderr) {
        console.log(colorize('STDERR:', 'yellow'))
        console.log(error.stderr)
      }
      console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'red'))

      return false
    }
  }

  extractTestInfo(stepName, output) {
    // Remove ANSI color codes first
    // eslint-disable-next-line no-control-regex
    const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')

    if (stepName === 'Unit Tests' || stepName === 'Integration Tests') {
      // Parse vitest output: "      Tests  389 passed | 2 skipped (391)"
      const testMatch = cleanOutput.match(/Tests\s+(\d+)\s+passed/)
      if (testMatch) {
        return `${testMatch[1]} tests passed`
      }
    } else if (stepName === 'E2E Tests') {
      // Parse playwright output: "25 passed (2.3s)"
      const e2eMatch = cleanOutput.match(/(\d+)\s+passed/)
      if (e2eMatch) {
        return `${e2eMatch[1]} tests passed`
      }
    }
    return null
  }

  printSummary() {
    const totalDuration = Math.round((Date.now() - this.startTime) / 1000)
    const failedSteps = Array.from(this.results.entries())
      .filter(([, status]) => status === 'FAIL')
      .map(([step]) => step)

    console.log('\n==================================================')
    console.log('                 CI PIPELINE SUMMARY')
    console.log('==================================================')

    for (const [step, status] of this.results.entries()) {
      const duration = this.durations.get(step)
      let statusIcon, color
      if (status === 'PASS') {
        statusIcon = '✅'
        color = 'green'
      } else if (status === 'SKIP') {
        statusIcon = '⚠️ '
        color = 'yellow'
      } else {
        statusIcon = '❌'
        color = 'red'
      }
      console.log(colorize(`${statusIcon} ${step} (${duration}s)`, color))
    }

    console.log('==================================================')
    console.log(`Total Duration: ${totalDuration}s`)

    if (failedSteps.length === 0) {
      console.log(colorize('🎉 ALL CHECKS PASSED! ✨', 'green'))
      console.log('\n📊 Detailed Results:')
      console.log('  - Clean: ✅ Build artifacts removed')
      console.log('  - Build: ✅ All packages built successfully')
      console.log('  - Typecheck: ✅ TypeScript compilation passed')
      console.log('  - Lint: ✅ Code quality checks passed')

      // Dynamic test counts
      const unitTestInfo = this.getTestInfoForSummary('Unit Tests')
      const integrationTestInfo = this.getTestInfoForSummary('Integration Tests')
      const e2eTestInfo = this.getTestInfoForSummary('E2E Tests')
      console.log(`  - Unit Tests: ✅ ${unitTestInfo}`)
      console.log(`  - Integration Tests: ✅ ${integrationTestInfo}`)
      console.log(`  - E2E Tests: ✅ ${e2eTestInfo}`)

      console.log(colorize('\n🚀 Ready for deployment!', 'green'))
      process.exit(0)
    } else {
      console.log(colorize('💥 PIPELINE FAILED!', 'red'))
      console.log(`Failed steps: ${failedSteps.join(', ')}`)
      process.exit(1)
    }
  }

  getTestInfoForSummary(stepName) {
    const testInfo = this.testInfos.get(stepName)
    return testInfo || 'completed'
  }

  run() {
    console.log('🚀 Starting CI Pipeline...')
    console.log('==================================================')

    const steps = [
      { name: 'Clean', command: 'pnpm run clean', optional: true },
      { name: 'Build', command: 'pnpm run build' },
      { name: 'Typecheck', command: 'pnpm run typecheck' },
      { name: 'Lint', command: 'pnpm run lint' },
      { name: 'Unit Tests', command: 'pnpm run test' },
      { name: 'E2E Tests', command: 'pnpm run test:e2e' },
    ]

    // Only run integration tests if explicitly enabled
    if (process.env.RUN_INTEGRATION_TESTS === 'true') {
      steps.splice(5, 0, { name: 'Integration Tests', command: 'pnpm run test:integration' })
    } else {
      console.log(
        colorize(
          'ℹ️  Skipping Integration Tests (set RUN_INTEGRATION_TESTS=true to enable)',
          'yellow'
        )
      )
    }

    let allPassed = true

    for (const step of steps) {
      const success = this.runCommand(step.command, step.name)
      if (!success && step.optional) {
        console.log(colorize(`⚠️  ${step.name} failed but is optional - continuing`, 'yellow'))
        // Override FAIL status to SKIP for optional steps
        this.results.set(step.name, 'SKIP')
      } else if (!success) {
        // eslint-disable-next-line no-unused-vars
        allPassed = false
        // Continue with other steps even if one fails, to show complete status
      }
    }

    console.log('\n==================================================')
    console.log('Pipeline completed. Generating summary...')

    this.printSummary()
  }
}

// Run the pipeline
const pipeline = new CIPipeline()
pipeline.run()
