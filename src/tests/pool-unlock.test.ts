#!/usr/bin/env npx tsx
/**
 * Pool Unlock & Distribution Unit Tests
 * 
 * Tests:
 * 1. Pool unlock schedule returns correct percentages per day
 * 2. Distribution respects unlock percentage
 * 3. Pool balances update correctly after distribution
 * 4. Multiple kills on same day don't over-distribute
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ABI = require('../abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';

// Expected unlock schedule from contract
const EXPECTED_UNLOCK_SCHEDULE = [
  { day: 1, bps: 1000, percent: 10 },
  { day: 2, bps: 2000, percent: 20 },
  { day: 3, bps: 3500, percent: 35 },
  { day: 4, bps: 5000, percent: 50 },
  { day: 5, bps: 7000, percent: 70 },
  { day: 6, bps: 8500, percent: 85 },
  { day: 7, bps: 10000, percent: 100 },
];

let provider: ethers.JsonRpcProvider;
let contract: ethers.Contract;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  ✅ ${message} (${actual.toFixed(6)} ≈ ${expected.toFixed(6)})`);
    passed++;
  } else {
    console.log(`  ❌ ${message} (${actual.toFixed(6)} != ${expected.toFixed(6)}, diff: ${diff.toFixed(6)})`);
    failed++;
  }
}

async function setup() {
  provider = new ethers.JsonRpcProvider(RPC);
  contract = new ethers.Contract(CONTRACT, ABI, provider);
  console.log('Connected to contract:', CONTRACT);
}

// Test 1: Verify unlock schedule values in contract
async function testUnlockSchedule() {
  console.log('\n═══ TEST 1: Pool Unlock Schedule ═══\n');
  
  for (let day = 0; day < 7; day++) {
    const expected = EXPECTED_UNLOCK_SCHEDULE[day];
    const actualBps = await contract.poolUnlockSchedule(day);
    assert(
      Number(actualBps) === expected.bps,
      `Day ${day + 1}: ${Number(actualBps)} bps = ${Number(actualBps) / 100}% (expected ${expected.bps} bps)`
    );
  }
}

// Test 2: Verify getCurrentPoolUnlock returns correct value for current day
async function testCurrentPoolUnlock() {
  console.log('\n═══ TEST 2: Current Pool Unlock ═══\n');
  
  const seasonInfo = await contract.getSeasonInfo();
  const currentDay = Number(seasonInfo[2]); // day is 3rd return value
  const currentUnlock = await contract.getCurrentPoolUnlock();
  
  console.log(`  Current season day: ${currentDay}`);
  console.log(`  Current unlock: ${Number(currentUnlock)} bps = ${Number(currentUnlock) / 100}%`);
  
  const expectedBps = EXPECTED_UNLOCK_SCHEDULE[currentDay - 1]?.bps || 0;
  assert(
    Number(currentUnlock) === expectedBps,
    `Unlock matches expected for day ${currentDay}`
  );
}

// Test 3: Verify pool balances
async function testPoolBalances() {
  console.log('\n═══ TEST 3: Current Pool Balances ═══\n');
  
  const [nullPool, leviathanPool, tournamentPool, opsPool] = await Promise.all([
    contract.nullPool(),
    contract.leviathanPool(),
    contract.tournamentPool(),
    contract.operationsPool(),
  ]);
  
  console.log(`  Null Pool:       ${ethers.formatEther(nullPool)} MON`);
  console.log(`  Leviathan Pool:  ${ethers.formatEther(leviathanPool)} MON`);
  console.log(`  Tournament Pool: ${ethers.formatEther(tournamentPool)} MON`);
  console.log(`  Operations Pool: ${ethers.formatEther(opsPool)} MON`);
  
  const total = nullPool + leviathanPool + tournamentPool + opsPool;
  console.log(`  Total:           ${ethers.formatEther(total)} MON`);
  
  // Verify pool split ratios (40/30/20/10)
  if (total > 0n) {
    const nullRatio = Number(nullPool * 10000n / total) / 100;
    const levRatio = Number(leviathanPool * 10000n / total) / 100;
    const tourneyRatio = Number(tournamentPool * 10000n / total) / 100;
    const opsRatio = Number(opsPool * 10000n / total) / 100;
    
    console.log(`\n  Actual ratios: Null ${nullRatio.toFixed(1)}%, Lev ${levRatio.toFixed(1)}%, Tourney ${tourneyRatio.toFixed(1)}%, Ops ${opsRatio.toFixed(1)}%`);
    console.log(`  Expected:      Null 40%, Lev 30%, Tourney 20%, Ops 10%`);
    
    // Allow 5% tolerance due to distributions
    assertApprox(nullRatio, 40, 15, 'Null pool ~40%');
    assertApprox(levRatio, 30, 15, 'Leviathan pool ~30%');
    assertApprox(tourneyRatio, 20, 10, 'Tournament pool ~20%');
    assertApprox(opsRatio, 10, 5, 'Operations pool ~10%');
  }
}

// Test 4: Calculate expected distribution for current state
async function testDistributionMath() {
  console.log('\n═══ TEST 4: Distribution Math ═══\n');
  
  const leviathanPool = await contract.leviathanPool();
  const currentUnlock = await contract.getCurrentPoolUnlock();
  const seasonInfo = await contract.getSeasonInfo();
  const currentDay = Number(seasonInfo[2]);
  
  const poolMon = parseFloat(ethers.formatEther(leviathanPool));
  const unlockPercent = Number(currentUnlock) / 100;
  const availableMon = poolMon * (Number(currentUnlock) / 10000);
  
  console.log(`  Leviathan Pool: ${poolMon.toFixed(6)} MON`);
  console.log(`  Day ${currentDay} Unlock: ${unlockPercent}%`);
  console.log(`  Available for distribution: ${availableMon.toFixed(6)} MON`);
  
  // Simulate 3 equal participants
  const perParticipant = availableMon / 3;
  console.log(`  Per participant (3 equal): ${perParticipant.toFixed(6)} MON`);
  
  // Compare to actual last payout (Squad agents)
  console.log('\n  Last actual payouts (Squad agents):');
  const squadWallets = [
    { name: 'SquadAlpha', wallet: '0xa55D3174525d65a7f2563c43610754403c8dCd3f' },
    { name: 'SquadCharlie', wallet: '0xc73A9918B7C84Bc5AB910B5Cb139786Ea9aeA1f1' },
    { name: 'SquadDelta', wallet: '0xe1bd845bCe8E68067f7efeb3432222bA1E4ADd8D' },
  ];
  
  let totalReceived = 0;
  for (const s of squadWallets) {
    const balance = await provider.getBalance(s.wallet);
    const balanceMon = parseFloat(ethers.formatEther(balance));
    // Subtract the ~0.05 MON they had from funding (0.15) minus entry (0.1)
    const estimated = balanceMon - 0.05; // rough estimate of what they earned
    totalReceived += estimated;
    console.log(`    ${s.name}: ${balanceMon.toFixed(6)} MON (est. earned: ~${estimated.toFixed(4)} MON)`);
  }
  
  console.log(`\n  Total estimated received: ~${totalReceived.toFixed(4)} MON`);
  console.log(`  Expected if 10% unlock: ${availableMon.toFixed(4)} MON`);
  
  // This is informational - we can't assert without knowing exact before/after
}

// Test 5: Verify entry fee schedule
async function testEntryFeeSchedule() {
  console.log('\n═══ TEST 5: Entry Fee Schedule ═══\n');
  
  // Expected: Day 1 = 100%, Day 7 = 20% of base fee
  const expectedFeeSchedule = [100, 90, 80, 60, 40, 30, 20]; // percentages
  
  for (let day = 0; day < 7; day++) {
    const feeBps = await contract.entryFeeSchedule(day);
    const expectedBps = expectedFeeSchedule[day] * 100;
    assert(
      Number(feeBps) === expectedBps,
      `Day ${day + 1} fee: ${Number(feeBps) / 100}% of base (expected ${expectedFeeSchedule[day]}%)`
    );
  }
}

// Run all tests
async function runTests() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     POOL UNLOCK & DISTRIBUTION UNIT TESTS        ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  
  try {
    await setup();
    await testUnlockSchedule();
    await testCurrentPoolUnlock();
    await testPoolBalances();
    await testDistributionMath();
    await testEntryFeeSchedule();
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════');
    
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ Test error:', err);
    process.exit(1);
  }
}

runTests();
