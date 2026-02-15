#!/usr/bin/env npx tsx
/**
 * Master Test Runner
 * Runs all test suites in sequence and generates a report
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const TEST_FILES = [
  { name: 'Contract Functions', file: 'contract-functions.test.ts' },
  { name: 'Entry Flow', file: 'entry-flow.test.ts' },
  { name: 'Leviathan Flow', file: 'leviathan-flow.test.ts' },
  { name: 'Null Flow', file: 'null-flow.test.ts' },
  { name: 'Tournament Flow', file: 'tournament-flow.test.ts' },
  { name: 'Season Flow', file: 'season-flow.test.ts' },
  { name: 'Pool Unlock', file: 'pool-unlock.test.ts' },
];

interface TestSuiteResult {
  name: string;
  file: string;
  passed: boolean;
  output: string;
  duration: number;
}

const results: TestSuiteResult[] = [];

function runTest(name: string, file: string): Promise<TestSuiteResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn('npx', ['tsx', `src/tests/${file}`], {
      cwd: process.cwd(),
      env: process.env,
    });

    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      const duration = Date.now() - start;
      resolve({
        name,
        file,
        passed: code === 0,
        output,
        duration,
      });
    });

    proc.on('error', (err) => {
      const duration = Date.now() - start;
      resolve({
        name,
        file,
        passed: false,
        output: `Error: ${err.message}`,
        duration,
      });
    });
  });
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║         THE REEF — COMPREHENSIVE TEST SUITE                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  console.log(`Running ${TEST_FILES.length} test suites...\n`);
  console.log('═'.repeat(65) + '\n');

  const startTime = Date.now();

  for (const test of TEST_FILES) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log(`▶ ${test.name} (${test.file})`);
    console.log(`${'─'.repeat(65)}\n`);

    const result = await runTest(test.name, test.file);
    results.push(result);

    console.log(`\n${result.passed ? '✅' : '❌'} ${test.name}: ${result.passed ? 'PASSED' : 'FAILED'} (${result.duration}ms)`);
    
    // Small delay between test suites to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  const totalDuration = Date.now() - startTime;

  // ═══════════════════════════════════════════════════════════════
  // GENERATE REPORT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(65));
  console.log('                    FINAL REPORT');
  console.log('═'.repeat(65) + '\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Test Suites: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`Duration:    ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('');

  console.log('Results:');
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`  ${icon} ${result.name.padEnd(25)} ${(result.duration + 'ms').padStart(8)}`);
  }

  if (failed > 0) {
    console.log('\nFailed test suites:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${result.name}: ${result.file}`);
    }
  }

  // Save report to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = 'src/tests/results';
  
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    duration: totalDuration,
    summary: { passed, failed, total: results.length },
    results: results.map(r => ({
      name: r.name,
      file: r.file,
      passed: r.passed,
      duration: r.duration,
    })),
  };

  const reportPath = `${reportDir}/${timestamp}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  console.log('\n' + '═'.repeat(65));
  if (failed === 0) {
    console.log('                  ✅ ALL TESTS PASSED!');
  } else {
    console.log('                  ❌ SOME TESTS FAILED');
  }
  console.log('═'.repeat(65) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
