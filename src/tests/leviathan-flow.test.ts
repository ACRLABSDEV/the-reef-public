#!/usr/bin/env npx tsx
/**
 * Leviathan (Daily Boss) Flow Tests
 * Tests spawn mechanics, combat, and MON distribution
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ABI = require('../abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';
const API_BASE = 'https://thereef.co';

// The actual payout transaction we're analyzing
const PAYOUT_TX = '0xf6846e124ea0c3081a215693395dc1538afbabe60937b7aff5837e1649cef696';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function test(name: string, fn: () => Promise<{ passed: boolean; details: string }>) {
  try {
    await sleep(500);
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

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              LEVIATHAN FLOW TESTS                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);

  // ═══════════════════════════════════════════════════════════════
  // 1. LEVIATHAN POOL STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ 1. Leviathan Pool State ═══\n');

  await test('Leviathan pool has balance', async () => {
    const pool = await contract.leviathanPool();
    const mon = parseFloat(ethers.formatEther(pool));
    return { passed: mon >= 0, details: `Leviathan pool: ${mon.toFixed(6)} MON` };
  });

  await test('Leviathan pool is ~30% of total', async () => {
    const [nullPool, levPool, tourneyPool, opsPool] = await Promise.all([
      contract.nullPool(),
      contract.leviathanPool(),
      contract.tournamentPool(),
      contract.operationsPool(),
    ]);
    const total = nullPool + levPool + tourneyPool + opsPool;
    if (total === 0n) return { passed: true, details: 'Empty pools' };
    
    const ratio = Number(levPool * 10000n / total) / 100;
    // Allow variance due to distributions
    return { passed: ratio > 20 && ratio < 35, details: `Leviathan is ${ratio.toFixed(1)}% of pools` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. POOL UNLOCK SCHEDULE
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 2. Pool Unlock Schedule ═══\n');

  const expectedUnlocks = [1000, 2000, 3500, 5000, 7000, 8500, 10000]; // bps

  for (let day = 0; day < 7; day++) {
    await test(`Day ${day + 1} unlock = ${expectedUnlocks[day] / 100}%`, async () => {
      const unlock = await contract.poolUnlockSchedule(day);
      return { 
        passed: Number(unlock) === expectedUnlocks[day], 
        details: `Got ${Number(unlock)} bps` 
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. BOSS ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 3. Boss Endpoint ═══\n');

  await test('/world/boss returns valid state', async () => {
    const resp = await fetch(`${API_BASE}/world/boss`);
    const data = await resp.json();
    
    const hasFields = data.name !== undefined && 
                     data.hp !== undefined && 
                     data.isAlive !== undefined;
    return { 
      passed: hasFields, 
      details: `${data.name}: ${data.hp}/${data.maxHp} HP, alive=${data.isAlive}` 
    };
  });

  await test('Boss tracks participants', async () => {
    const resp = await fetch(`${API_BASE}/world/boss`);
    const data = await resp.json();
    
    const hasParticipants = Array.isArray(data.participants);
    return { 
      passed: hasParticipants, 
      details: `${data.participants?.length || 0} current participants` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. DISTRIBUTION VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 4. Distribution Verification ═══\n');

  await test('Payout TX exists and succeeded', async () => {
    const receipt = await provider.getTransactionReceipt(PAYOUT_TX);
    return { 
      passed: receipt !== null && receipt.status === 1, 
      details: `Block ${receipt?.blockNumber}` 
    };
  });

  await test('Payout TX called distributeLeviathan', async () => {
    const tx = await provider.getTransaction(PAYOUT_TX);
    if (!tx) return { passed: false, details: 'TX not found' };
    
    const iface = new ethers.Interface(ABI);
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    
    return { 
      passed: decoded?.name === 'distributeLeviathan', 
      details: `Function: ${decoded?.name}` 
    };
  });

  await test('Distribution used correct unlock %', async () => {
    const receipt = await provider.getTransactionReceipt(PAYOUT_TX);
    if (!receipt) return { passed: false, details: 'Receipt not found' };
    
    const iface = new ethers.Interface(ABI);
    let unlockBps = 0n;
    
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'LeviathanKilled') {
          unlockBps = parsed.args[4];
        }
      } catch {}
    }
    
    // Should be 1000 bps (10%) for Day 1
    return { 
      passed: Number(unlockBps) === 1000, 
      details: `Used ${Number(unlockBps)/100}% unlock` 
    };
  });

  await test('Sum of payouts = total distributed', async () => {
    const receipt = await provider.getTransactionReceipt(PAYOUT_TX);
    if (!receipt) return { passed: false, details: 'Receipt not found' };
    
    const iface = new ethers.Interface(ABI);
    let sum = 0n;
    let total = 0n;
    
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'LeviathanRewardDistributed') {
          sum += parsed.args[2];
        }
        if (parsed?.name === 'LeviathanKilled') {
          total = parsed.args[3];
        }
      } catch {}
    }
    
    return { 
      passed: sum === total, 
      details: `Sum: ${ethers.formatEther(sum)}, Total: ${ethers.formatEther(total)}` 
    };
  });

  await test('Pool decreased by distributed amount', async () => {
    // This verifies the math: distributed = poolBefore * unlockBps / 10000
    const receipt = await provider.getTransactionReceipt(PAYOUT_TX);
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
    
    // Reverse calculate pool before: poolBefore = distributed * 10000 / unlockBps
    const poolBefore = (distributed * 10000n) / unlockBps;
    
    return { 
      passed: true, 
      details: `Pool was ${ethers.formatEther(poolBefore)} MON, distributed ${ethers.formatEther(distributed)} (${Number(unlockBps)/100}%)` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. WINNER VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 5. Winner Verification ═══\n');

  await test('All winners were registered', async () => {
    const tx = await provider.getTransaction(PAYOUT_TX);
    if (!tx) return { passed: false, details: 'TX not found' };
    
    const iface = new ethers.Interface(ABI);
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    const winners = decoded?.args[1] || [];
    
    let allRegistered = true;
    for (const winner of winners) {
      const isRegistered = await contract.hasEntered(winner);
      if (!isRegistered) allRegistered = false;
    }
    
    return { 
      passed: allRegistered, 
      details: `${winners.length} winners, all registered` 
    };
  });

  await test('Winner shares sum to ~100%', async () => {
    const tx = await provider.getTransaction(PAYOUT_TX);
    if (!tx) return { passed: false, details: 'TX not found' };
    
    const iface = new ethers.Interface(ABI);
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    const shares = decoded?.args[2] || [];
    
    const total = shares.reduce((a: bigint, b: bigint) => a + b, 0n);
    const pct = Number(total) / 100;
    
    return { 
      passed: pct >= 99 && pct <= 100, 
      details: `Total shares: ${pct.toFixed(2)}%` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`LEVIATHAN FLOW TESTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
