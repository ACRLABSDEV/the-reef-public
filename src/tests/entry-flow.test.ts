#!/usr/bin/env npx tsx
/**
 * Entry Flow Tests
 * Tests the complete agent entry process from wallet creation to game registration
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
  console.log('║              ENTRY FLOW TESTS                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);

  // ═══════════════════════════════════════════════════════════════
  // 1. ENTRY FEE SCHEDULE VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ 1. Entry Fee Schedule ═══\n');

  const expectedFees = [10000, 9000, 8000, 6000, 4000, 3000, 2000]; // bps
  
  for (let day = 0; day < 7; day++) {
    await test(`Day ${day + 1} entry fee = ${expectedFees[day] / 100}% of base`, async () => {
      const feeBps = await contract.entryFeeSchedule(day);
      return { 
        passed: Number(feeBps) === expectedFees[day], 
        details: `Got ${Number(feeBps)} bps` 
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. CURRENT FEE CALCULATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 2. Current Fee Calculation ═══\n');

  await test('getCurrentEntryFee() matches base * schedule', async () => {
    const baseFee = await contract.baseEntryFee();
    const currentFee = await contract.getCurrentEntryFee();
    const seasonInfo = await contract.getSeasonInfo();
    const day = Number(seasonInfo[2]);
    const daySchedule = await contract.entryFeeSchedule(day - 1);
    
    const expected = (BigInt(baseFee) * BigInt(daySchedule)) / 10000n;
    return { 
      passed: currentFee === expected, 
      details: `Day ${day}: ${ethers.formatEther(currentFee)} MON` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. POOL SPLIT VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 3. Pool Splits ═══\n');

  await test('Null split = 4000 bps (40%)', async () => {
    const split = await contract.nullSplit();
    return { passed: Number(split) === 4000, details: `Got ${Number(split)} bps` };
  });

  await test('Leviathan split = 3000 bps (30%)', async () => {
    const split = await contract.leviathanSplit();
    return { passed: Number(split) === 3000, details: `Got ${Number(split)} bps` };
  });

  await test('Tournament split = 2000 bps (20%)', async () => {
    const split = await contract.tournamentSplit();
    return { passed: Number(split) === 2000, details: `Got ${Number(split)} bps` };
  });

  await test('Operations split = 1000 bps (10%)', async () => {
    const split = await contract.operationsSplit();
    return { passed: Number(split) === 1000, details: `Got ${Number(split)} bps` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. ENTRY VALIDATION
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 4. Entry Validation ═══\n');

  await test('Random wallet has not entered', async () => {
    const randomWallet = ethers.Wallet.createRandom().address;
    const hasEntered = await contract.hasEntered(randomWallet);
    return { passed: !hasEntered, details: `${randomWallet.slice(0,10)}... not registered` };
  });

  await test('Known registered wallet has entered', async () => {
    const knownWallet = '0xa55D3174525d65a7f2563c43610754403c8dCd3f'; // SquadAlpha
    const hasEntered = await contract.hasEntered(knownWallet);
    return { passed: hasEntered, details: `SquadAlpha is registered` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. SIMULATED ENTRY FLOW
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ 5. Simulated Entry Flow ═══\n');

  await test('Entry status endpoint returns correct structure', async () => {
    const randomWallet = ethers.Wallet.createRandom().address;
    const resp = await fetch(`${API_BASE}/enter/status/${randomWallet}`);
    const data = await resp.json();
    
    const hasRequired = data.wallet && data.registered !== undefined && data.paymentRequired;
    return { 
      passed: hasRequired && !data.registered, 
      details: `New wallet: registered=${data.registered}, fee=${data.paymentRequired?.amount}` 
    };
  });

  await test('Entry status shows registered for existing agent', async () => {
    const resp = await fetch(`${API_BASE}/enter/status/0xa55D3174525d65a7f2563c43610754403c8dCd3f`);
    const data = await resp.json();
    return { 
      passed: data.registered === true, 
      details: `SquadAlpha: registered=${data.registered}` 
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`ENTRY FLOW TESTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

main().catch(console.error);
