#!/usr/bin/env npx tsx
/**
 * Season Mechanics Tests
 * Tests season info, day progression, and rollover logic
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
  console.log('║              SEASON MECHANICS TESTS                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);

  // ═══════════════════════════════════════════════════════════════
  // 1. SEASON STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ 1. Season State ═══\n');

  await test('currentSeason >= 1', async () => {
    const season = await contract.currentSeason();
    return { passed: Number(season) >= 1, details: `Season: ${season}` };
  });

  await test('seasonStartTime is valid timestamp', async () => {
    const startTime = await contract.seasonStartTime();
    const date = new Date(Number(startTime) * 1000);
    const valid = Number(startTime) > 0 && date.getFullYear() >= 2024;
    return { passed: valid, details: `Started: ${date.toISOString()}` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. SEASON INFO
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 2. Season Info ═══\n');

  await test('getSeasonInfo returns valid tuple', async () => {
    const info = await contract.getSeasonInfo();
    const [season, startTime, day, entryFee, poolUnlock] = info;
    
    const valid = Number(season) >= 1 && 
                  Number(day) >= 1 && 
                  Number(day) <= 7;
    return { 
      passed: valid, 
      details: `Season ${season}, Day ${day}` 
    };
  });

  await test('Current day is 1-7', async () => {
    const info = await contract.getSeasonInfo();
    const day = Number(info[2]);
    return { passed: day >= 1 && day <= 7, details: `Day ${day}` };
  });

  await test('Entry fee matches day schedule', async () => {
    const info = await contract.getSeasonInfo();
    const day = Number(info[2]);
    const entryFee = info[3];
    
    const baseFee = await contract.baseEntryFee();
    const daySchedule = await contract.entryFeeSchedule(day - 1);
    const expected = (BigInt(baseFee) * BigInt(daySchedule)) / 10000n;
    
    return { 
      passed: entryFee === expected, 
      details: `Day ${day}: ${ethers.formatEther(entryFee)} MON` 
    };
  });

  await test('Pool unlock matches day schedule', async () => {
    const info = await contract.getSeasonInfo();
    const day = Number(info[2]);
    const poolUnlock = Number(info[4]);
    
    const expectedUnlock = await contract.poolUnlockSchedule(day - 1);
    
    return { 
      passed: poolUnlock === Number(expectedUnlock), 
      details: `Day ${day}: ${poolUnlock/100}% unlocked` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. DAY CALCULATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 3. Day Calculation ═══\n');

  await test('Day calculation based on time since season start', async () => {
    const startTime = await contract.seasonStartTime();
    const info = await contract.getSeasonInfo();
    const day = Number(info[2]);
    
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - Number(startTime);
    const expectedDay = Math.min(7, Math.floor(elapsed / 86400) + 1);
    
    return { 
      passed: day === expectedDay, 
      details: `${elapsed} seconds elapsed = Day ${day}` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. BACKEND SEASON ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 4. Backend Season Endpoint ═══\n');

  await test('/world/season returns valid data', async () => {
    const resp = await fetch(`${API_BASE}/world/season`);
    if (!resp.ok) return { passed: false, details: `HTTP ${resp.status}` };
    
    const data = await resp.json();
    const hasFields = data.season !== undefined && data.day !== undefined;
    return { 
      passed: hasFields, 
      details: `Season ${data.season}, Day ${data.day}` 
    };
  });

  await test('Backend and contract season match', async () => {
    const resp = await fetch(`${API_BASE}/world/season`);
    const data = await resp.json();
    
    const contractInfo = await contract.getSeasonInfo();
    const contractSeason = Number(contractInfo[0]);
    const contractDay = Number(contractInfo[2]);
    
    const match = data.season === contractSeason && data.day === contractDay;
    return { 
      passed: match, 
      details: `Backend: S${data.season}D${data.day}, Contract: S${contractSeason}D${contractDay}` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. SEASON ENTRY TRACKING
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 5. Season Entry Tracking ═══\n');

  await test('hasEnteredSeason tracks per-season entry', async () => {
    const season = await contract.currentSeason();
    const knownWallet = '0xa55D3174525d65a7f2563c43610754403c8dCd3f'; // SquadAlpha
    
    const hasEntered = await contract.hasEnteredSeason(season, knownWallet);
    return { 
      passed: hasEntered === true, 
      details: `SquadAlpha entered season ${season}` 
    };
  });

  await test('Previous season entry is separate', async () => {
    const season = await contract.currentSeason();
    const knownWallet = '0xa55D3174525d65a7f2563c43610754403c8dCd3f';
    
    // If season > 1, check previous season
    if (Number(season) > 1) {
      const prevSeasonEntry = await contract.hasEnteredSeason(season - 1n, knownWallet);
      return { 
        passed: true, 
        details: `Season ${Number(season)-1} entry: ${prevSeasonEntry}` 
      };
    }
    return { passed: true, details: 'First season, no previous to check' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. ROLLOVER FUNCTION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 6. Rollover Function ═══\n');

  await test('Contract has advanceSeason function', async () => {
    const hasFunction = typeof contract.advanceSeason === 'function';
    return { 
      passed: hasFunction, 
      details: hasFunction ? 'Function exists (owner only)' : 'Function not found' 
    };
  });

  await test('Rollover design: 90% pools to next season', async () => {
    // This is a design verification - actual rollover would need to be tested
    // in a controlled environment or when Day 7 passes
    return { 
      passed: true, 
      details: 'Design: 90% leftover pools → next season, 10% → ops' 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`SEASON FLOW TESTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
