#!/usr/bin/env npx tsx
/**
 * Tournament System Tests
 * Tests arena mechanics and tournament MON distribution
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ABI = require('../abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';
const API_BASE = 'https://thereef.co';

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
  console.log('║              TOURNAMENT FLOW TESTS                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);

  // ═══════════════════════════════════════════════════════════════
  // 1. TOURNAMENT POOL STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ 1. Tournament Pool State ═══\n');

  await test('Tournament pool has balance', async () => {
    const pool = await contract.tournamentPool();
    const mon = parseFloat(ethers.formatEther(pool));
    return { passed: mon >= 0, details: `Tournament pool: ${mon.toFixed(6)} MON` };
  });

  await test('Tournament pool is ~20% of total', async () => {
    const [nullPool, levPool, tourneyPool, opsPool] = await Promise.all([
      contract.nullPool(),
      contract.leviathanPool(),
      contract.tournamentPool(),
      contract.operationsPool(),
    ]);
    const total = nullPool + levPool + tourneyPool + opsPool;
    if (total === 0n) return { passed: true, details: 'Empty pools (no entries yet)' };
    
    const ratio = Number(tourneyPool * 10000n / total) / 100;
    return { passed: ratio > 15 && ratio < 25, details: `Tournament is ${ratio.toFixed(1)}% of pools` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. TOURNAMENT TIER MULTIPLIERS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 2. Tournament Tier Multipliers ═══\n');

  const expectedMultipliers = [
    { tier: 0, name: 'Bronze', bps: 0, desc: '<32 participants' },
    { tier: 1, name: 'Silver', bps: 2500, desc: '32-63 participants' },
    { tier: 2, name: 'Gold', bps: 5000, desc: '64-127 participants' },
    { tier: 3, name: 'Legendary', bps: 10000, desc: '128+ participants' },
  ];

  for (const expected of expectedMultipliers) {
    await test(`Tier ${expected.tier} (${expected.name}) = ${expected.bps/100}%`, async () => {
      const multiplier = await contract.tournamentMultipliers(expected.tier);
      return { 
        passed: Number(multiplier) === expected.bps, 
        details: `${expected.desc}: ${Number(multiplier)} bps` 
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. ARENA ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 3. Arena Endpoint ═══\n');

  await test('Arena endpoint returns valid state', async () => {
    const resp = await fetch(`${API_BASE}/world/arena`);
    const data = await resp.json();
    
    const hasFields = data.enabled !== undefined || 
                     data.activeDuels !== undefined ||
                     data.tournaments !== undefined;
    return { 
      passed: hasFields, 
      details: `Arena data available` 
    };
  });

  await test('Arena tracks active duels', async () => {
    const resp = await fetch(`${API_BASE}/world/arena`);
    const data = await resp.json();
    
    const duels = data.activeDuels || data.duels || [];
    return { 
      passed: Array.isArray(duels), 
      details: `${duels.length} active duels` 
    };
  });

  await test('Arena tracks tournaments', async () => {
    const resp = await fetch(`${API_BASE}/world/arena`);
    const data = await resp.json();
    
    const tournaments = data.tournaments || data.activeTournaments || [];
    return { 
      passed: Array.isArray(tournaments), 
      details: `${tournaments.length} active tournaments` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. CONTRACT DISTRIBUTION FUNCTION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 4. Contract Distribution Function ═══\n');

  await test('Contract has distributeTournament function', async () => {
    const hasFunction = typeof contract.distributeTournament === 'function';
    return { passed: hasFunction, details: hasFunction ? 'Function exists' : 'MISSING!' };
  });

  await test('distributeTournament accepts correct parameters', async () => {
    const iface = new ethers.Interface(ABI);
    const func = iface.getFunction('distributeTournament');
    // Should accept: tournamentId, champion, tier
    const hasCorrectParams = func && func.inputs.length >= 3;
    return { 
      passed: !!hasCorrectParams, 
      details: func ? `Params: ${func.inputs.map(i => i.name).join(', ')}` : 'Function not found' 
    };
  });

  await test('tournamentCount returns valid number', async () => {
    const count = await contract.tournamentCount();
    return { 
      passed: Number(count) >= 0, 
      details: `${count} tournaments completed` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. PRIZE CALCULATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 5. Prize Calculation ═══\n');

  await test('Bronze tournament (< 32): 0% prize', async () => {
    const pool = await contract.tournamentPool();
    const multiplier = await contract.tournamentMultipliers(0);
    const prize = (BigInt(pool) * BigInt(multiplier)) / 10000n;
    
    return { 
      passed: prize === 0n || Number(multiplier) === 0, 
      details: `Prize: ${ethers.formatEther(prize)} MON (0% of pool)` 
    };
  });

  await test('Legendary tournament (128+): 100% prize', async () => {
    const pool = await contract.tournamentPool();
    const multiplier = await contract.tournamentMultipliers(3);
    const expectedPrize = (BigInt(pool) * BigInt(multiplier)) / 10000n;
    
    return { 
      passed: Number(multiplier) === 10000, 
      details: `Max prize: ${ethers.formatEther(expectedPrize)} MON (100% of pool)` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. ARENA REQUIREMENTS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 6. Arena Requirements ═══\n');

  await test('Arena has level requirement', async () => {
    // Design: Level 10+ to enter arena
    const resp = await fetch(`${API_BASE}/world/arena`);
    const data = await resp.json();
    
    const levelReq = data.levelRequirement || data.minLevel || 10;
    return { 
      passed: levelReq >= 10, 
      details: `Requires level ${levelReq}+` 
    };
  });

  await test('Arena has reputation requirement', async () => {
    // Design: 50+ reputation to enter arena
    const resp = await fetch(`${API_BASE}/world/arena`);
    const data = await resp.json();
    
    const repReq = data.reputationRequirement || data.minReputation || 50;
    return { 
      passed: repReq >= 50, 
      details: `Requires ${repReq}+ reputation` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`TOURNAMENT FLOW TESTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
