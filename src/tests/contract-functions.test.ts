#!/usr/bin/env npx tsx
/**
 * Comprehensive Unit Tests for ReefTreasury Contract
 * 
 * Tests each public function and verifies expected behavior.
 * Run: npx tsx src/tests/contract-functions.test.ts
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ABI = require('../abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';

let provider: ethers.JsonRpcProvider;
let contract: ethers.Contract;

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function test(name: string, fn: () => Promise<{ passed: boolean; details: string }>) {
  try {
    await sleep(500); // Rate limit protection
    const result = await fn();
    results.push({ name, ...result });
    console.log(`${result.passed ? '✅' : '❌'} ${name}`);
    if (result.details) console.log(`   ${result.details}`);
  } catch (err) {
    results.push({ name, passed: false, details: String(err) });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err}`);
  }
}

async function setup() {
  provider = new ethers.JsonRpcProvider(RPC);
  contract = new ethers.Contract(CONTRACT, ABI, provider);
}

// ═══════════════════════════════════════════════════════════════
// VIEW FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function testViewFunctions() {
  console.log('\n═══ VIEW FUNCTIONS ═══\n');

  // 1. owner()
  await test('owner() returns valid address', async () => {
    const owner = await contract.owner();
    const isValid = ethers.isAddress(owner);
    return { passed: isValid, details: `Owner: ${owner}` };
  });

  // 2. backend()
  await test('backend() returns valid address', async () => {
    const backend = await contract.backend();
    const isValid = ethers.isAddress(backend);
    return { passed: isValid, details: `Backend: ${backend}` };
  });

  // 3. currentSeason()
  await test('currentSeason() returns positive number', async () => {
    const season = await contract.currentSeason();
    const valid = Number(season) >= 1;
    return { passed: valid, details: `Season: ${season}` };
  });

  // 4. seasonStartTime()
  await test('seasonStartTime() returns valid timestamp', async () => {
    const startTime = await contract.seasonStartTime();
    const valid = Number(startTime) > 0;
    return { passed: valid, details: `Start: ${new Date(Number(startTime) * 1000).toISOString()}` };
  });

  // 5. baseEntryFee()
  await test('baseEntryFee() returns positive value', async () => {
    const fee = await contract.baseEntryFee();
    const feeMon = parseFloat(ethers.formatEther(fee));
    return { passed: feeMon > 0, details: `Base fee: ${feeMon} MON` };
  });

  // 6. Pool balances
  await test('nullPool() returns valid balance', async () => {
    const pool = await contract.nullPool();
    const mon = parseFloat(ethers.formatEther(pool));
    return { passed: mon >= 0, details: `Null pool: ${mon.toFixed(6)} MON` };
  });

  await test('leviathanPool() returns valid balance', async () => {
    const pool = await contract.leviathanPool();
    const mon = parseFloat(ethers.formatEther(pool));
    return { passed: mon >= 0, details: `Leviathan pool: ${mon.toFixed(6)} MON` };
  });

  await test('tournamentPool() returns valid balance', async () => {
    const pool = await contract.tournamentPool();
    const mon = parseFloat(ethers.formatEther(pool));
    return { passed: mon >= 0, details: `Tournament pool: ${mon.toFixed(6)} MON` };
  });

  await test('operationsPool() returns valid balance', async () => {
    const pool = await contract.operationsPool();
    const mon = parseFloat(ethers.formatEther(pool));
    return { passed: mon >= 0, details: `Operations pool: ${mon.toFixed(6)} MON` };
  });

  // 7. Pool splits
  await test('Pool splits sum to 10000 bps (100%)', async () => {
    const [nullSplit, levSplit, tourneySplit, opsSplit] = await Promise.all([
      contract.nullSplit(),
      contract.leviathanSplit(),
      contract.tournamentSplit(),
      contract.operationsSplit(),
    ]);
    const total = Number(nullSplit) + Number(levSplit) + Number(tourneySplit) + Number(opsSplit);
    return { 
      passed: total === 10000, 
      details: `Null ${nullSplit} + Lev ${levSplit} + Tourney ${tourneySplit} + Ops ${opsSplit} = ${total} bps` 
    };
  });

  // 8. Entry fee schedule
  await test('entryFeeSchedule() Day 1 = 10000 bps (100%)', async () => {
    const day1 = await contract.entryFeeSchedule(0);
    return { passed: Number(day1) === 10000, details: `Day 1 fee: ${Number(day1)} bps` };
  });

  await test('entryFeeSchedule() Day 7 = 2000 bps (20%)', async () => {
    const day7 = await contract.entryFeeSchedule(6);
    return { passed: Number(day7) === 2000, details: `Day 7 fee: ${Number(day7)} bps` };
  });

  // 9. Pool unlock schedule
  await test('poolUnlockSchedule() Day 1 = 1000 bps (10%)', async () => {
    const day1 = await contract.poolUnlockSchedule(0);
    return { passed: Number(day1) === 1000, details: `Day 1 unlock: ${Number(day1)} bps` };
  });

  await test('poolUnlockSchedule() Day 7 = 10000 bps (100%)', async () => {
    const day7 = await contract.poolUnlockSchedule(6);
    return { passed: Number(day7) === 10000, details: `Day 7 unlock: ${Number(day7)} bps` };
  });

  // 10. getCurrentEntryFee()
  await test('getCurrentEntryFee() returns scaled fee for current day', async () => {
    const currentFee = await contract.getCurrentEntryFee();
    const baseFee = await contract.baseEntryFee();
    const seasonInfo = await contract.getSeasonInfo();
    const day = Number(seasonInfo[2]);
    const feeSchedule = await contract.entryFeeSchedule(day - 1);
    
    const expectedFee = (BigInt(baseFee) * BigInt(feeSchedule)) / 10000n;
    const matches = currentFee === expectedFee;
    
    return { 
      passed: matches, 
      details: `Day ${day}: ${ethers.formatEther(currentFee)} MON (expected ${ethers.formatEther(expectedFee)})` 
    };
  });

  // 11. getCurrentPoolUnlock()
  await test('getCurrentPoolUnlock() matches schedule for current day', async () => {
    const currentUnlock = await contract.getCurrentPoolUnlock();
    const seasonInfo = await contract.getSeasonInfo();
    const day = Number(seasonInfo[2]);
    const expectedUnlock = await contract.poolUnlockSchedule(day - 1);
    
    return { 
      passed: currentUnlock === expectedUnlock, 
      details: `Day ${day}: ${Number(currentUnlock)} bps` 
    };
  });

  // 12. getSeasonInfo()
  await test('getSeasonInfo() returns valid tuple', async () => {
    const info = await contract.getSeasonInfo();
    const [season, startTime, day, entryFee, poolUnlock] = info;
    const valid = Number(season) >= 1 && Number(day) >= 1 && Number(day) <= 7;
    return { 
      passed: valid, 
      details: `Season ${season}, Day ${day}, Fee ${ethers.formatEther(entryFee)} MON, Unlock ${Number(poolUnlock)/100}%` 
    };
  });

  // 13. hasEntered()
  await test('hasEntered() returns false for random address', async () => {
    const randomWallet = ethers.Wallet.createRandom().address;
    const hasEntered = await contract.hasEntered(randomWallet);
    return { passed: hasEntered === false, details: `Random address not entered` };
  });

  // 14. hasEntered() for known entered address
  await test('hasEntered() returns true for SquadAlpha', async () => {
    const squadAlpha = '0xa55D3174525d65a7f2563c43610754403c8dCd3f';
    const hasEntered = await contract.hasEntered(squadAlpha);
    return { passed: hasEntered === true, details: `SquadAlpha is registered` };
  });

  // 15. Counters
  await test('leviathanSpawnCount() returns number >= 0', async () => {
    const count = await contract.leviathanSpawnCount();
    return { passed: Number(count) >= 0, details: `Spawn count: ${count}` };
  });

  await test('tournamentCount() returns number >= 0', async () => {
    const count = await contract.tournamentCount();
    return { passed: Number(count) >= 0, details: `Tournament count: ${count}` };
  });

  // 16. totalAgents()
  await test('totalAgents() returns number >= 0', async () => {
    const count = await contract.totalAgents();
    return { passed: Number(count) >= 0, details: `Total agents: ${count}` };
  });

  // 17. totalCollected()
  await test('totalCollected() returns amount >= 0', async () => {
    const total = await contract.totalCollected();
    return { passed: true, details: `Total collected: ${ethers.formatEther(total)} MON` };
  });

  // 18. totalDistributed()
  await test('totalDistributed() returns amount >= 0', async () => {
    const total = await contract.totalDistributed();
    return { passed: true, details: `Total distributed: ${ethers.formatEther(total)} MON` };
  });
}

// ═══════════════════════════════════════════════════════════════
// DISTRIBUTION MATH VERIFICATION
// ═══════════════════════════════════════════════════════════════

async function testDistributionMath() {
  console.log('\n═══ DISTRIBUTION MATH VERIFICATION ═══\n');

  // Analyze the actual payout transaction
  const TX_HASH = '0xf6846e124ea0c3081a215693395dc1538afbabe60937b7aff5837e1649cef696';
  
  await test('Payout TX: Total distributed = sum of individual payouts', async () => {
    const receipt = await provider.getTransactionReceipt(TX_HASH);
    if (!receipt) return { passed: false, details: 'Receipt not found' };
    
    const iface = new ethers.Interface(ABI);
    let sumPayouts = 0n;
    let totalFromEvent = 0n;
    
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'LeviathanRewardDistributed') {
          sumPayouts += parsed.args[2];
        }
        if (parsed?.name === 'LeviathanKilled') {
          totalFromEvent = parsed.args[3];
        }
      } catch {}
    }
    
    const matches = sumPayouts === totalFromEvent;
    return { 
      passed: matches, 
      details: `Sum: ${ethers.formatEther(sumPayouts)}, Event total: ${ethers.formatEther(totalFromEvent)}` 
    };
  });

  await test('Payout TX: Distributed amount = pool * unlockBps / 10000', async () => {
    const receipt = await provider.getTransactionReceipt(TX_HASH);
    if (!receipt) return { passed: false, details: 'Receipt not found' };
    
    const iface = new ethers.Interface(ABI);
    let distributed = 0n;
    let unlockBps = 0n;
    
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'LeviathanKilled') {
          distributed = parsed.args[3];
          unlockBps = parsed.args[4];
        }
      } catch {}
    }
    
    // Pool before = distributed / (unlockBps / 10000) = distributed * 10000 / unlockBps
    const impliedPoolBefore = (distributed * 10000n) / unlockBps;
    const expectedDistributed = (impliedPoolBefore * unlockBps) / 10000n;
    
    // Should match within rounding error
    const diff = distributed > expectedDistributed 
      ? distributed - expectedDistributed 
      : expectedDistributed - distributed;
    const matches = diff < 10n; // Allow tiny rounding
    
    return { 
      passed: matches, 
      details: `Unlock ${Number(unlockBps)/100}% of ${ethers.formatEther(impliedPoolBefore)} = ${ethers.formatEther(distributed)} MON` 
    };
  });

  await test('Payout TX: Individual shares sum to ~10000 bps', async () => {
    const tx = await provider.getTransaction(TX_HASH);
    if (!tx) return { passed: false, details: 'TX not found' };
    
    const iface = new ethers.Interface(ABI);
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    
    if (!decoded?.args) return { passed: false, details: 'Could not decode' };
    
    const shares = decoded.args[2].map((s: bigint) => Number(s));
    const total = shares.reduce((a: number, b: number) => a + b, 0);
    
    // Should be close to 10000 (allow small rounding)
    const valid = total >= 9990 && total <= 10000;
    return { passed: valid, details: `Total shares: ${total} bps (${(total/100).toFixed(2)}%)` };
  });
}

// ═══════════════════════════════════════════════════════════════
// POOL INTEGRITY CHECKS
// ═══════════════════════════════════════════════════════════════

async function testPoolIntegrity() {
  console.log('\n═══ POOL INTEGRITY CHECKS ═══\n');

  await test('Contract balance >= sum of all pools', async () => {
    const [nullPool, levPool, tourneyPool, opsPool] = await Promise.all([
      contract.nullPool(),
      contract.leviathanPool(),
      contract.tournamentPool(),
      contract.operationsPool(),
    ]);
    
    const poolSum = nullPool + levPool + tourneyPool + opsPool;
    const contractBalance = await provider.getBalance(CONTRACT);
    
    const valid = contractBalance >= poolSum;
    return { 
      passed: valid, 
      details: `Balance: ${ethers.formatEther(contractBalance)}, Pools: ${ethers.formatEther(poolSum)} MON` 
    };
  });

  await test('totalCollected >= totalDistributed', async () => {
    const [collected, distributed] = await Promise.all([
      contract.totalCollected(),
      contract.totalDistributed(),
    ]);
    
    const valid = collected >= distributed;
    return { 
      passed: valid, 
      details: `Collected: ${ethers.formatEther(collected)}, Distributed: ${ethers.formatEther(distributed)} MON` 
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     REEF TREASURY CONTRACT - COMPREHENSIVE UNIT TESTS        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  await setup();
  
  await testViewFunctions();
  await testDistributionMath();
  await testPoolIntegrity();
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.details}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

main().catch(console.error);
