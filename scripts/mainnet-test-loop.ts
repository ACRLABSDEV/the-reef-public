#!/usr/bin/env npx tsx
/**
 * Mainnet Test Loop - Quick surgical validation
 * Creates 2 agents, tests core game actions
 */
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const ABI = require('../src/abi/ReefTreasury.json');
const CONTRACT = '0xCc5135fca944c3b267517A7E46E97A06FA27B97A';
const RPC = 'https://rpc.monad.xyz';
const API = 'https://thereef.co';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface TestResult {
  test: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<boolean | string>) {
  try {
    const result = await fn();
    const passed = result === true || typeof result === 'string';
    results.push({ test: name, passed, detail: typeof result === 'string' ? result : undefined });
    console.log(passed ? `✅ ${name}` : `❌ ${name}`);
    if (typeof result === 'string') console.log(`   ${result}`);
  } catch (err: any) {
    results.push({ test: name, passed: false, detail: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('\n🧪 MAINNET TEST LOOP\n' + '='.repeat(40) + '\n');
  
  // Setup
  const walletData = JSON.parse(readFileSync('/data/.secrets/reef-mainnet-wallet.json', 'utf-8'));
  const provider = new ethers.JsonRpcProvider(RPC, { chainId: 143, name: 'monad-mainnet' });
  const mainWallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  // Create 2 test wallets
  const agent1Wallet = ethers.Wallet.createRandom().connect(provider);
  const agent2Wallet = ethers.Wallet.createRandom().connect(provider);
  
  console.log(`Main wallet: ${mainWallet.address}`);
  console.log(`Agent1: ${agent1Wallet.address}`);
  console.log(`Agent2: ${agent2Wallet.address}\n`);
  
  // Phase 1: Check fresh DB
  await test('DB wiped (tick < 100)', async () => {
    const res = await fetch(`${API}/world`);
    const data = await res.json();
    return data.tick < 100 ? `tick=${data.tick}` : false;
  });
  
  await test('No agents in fresh DB', async () => {
    const res = await fetch(`${API}/world`);
    const data = await res.json();
    return data.totalAgents === 0 ? 'totalAgents=0' : false;
  });
  
  // Phase 2: Fund test wallets
  await test('Fund Agent1 (15 MON)', async () => {
    const tx = await mainWallet.sendTransaction({
      to: agent1Wallet.address,
      value: ethers.parseEther('15'),
    });
    await tx.wait();
    return `tx=${tx.hash.slice(0,10)}...`;
  });
  
  await test('Fund Agent2 (15 MON)', async () => {
    const tx = await mainWallet.sendTransaction({
      to: agent2Wallet.address,
      value: ethers.parseEther('15'),
    });
    await tx.wait();
    return `tx=${tx.hash.slice(0,10)}...`;
  });
  
  // Phase 3: Contract entry
  const entryFee = await contract.getCurrentEntryFee();
  console.log(`\nEntry fee: ${ethers.formatEther(entryFee)} MON\n`);
  
  await test('Agent1 enter() on contract', async () => {
    const tx = await contract.connect(agent1Wallet).enter({ value: entryFee });
    await tx.wait();
    return `tx=${tx.hash.slice(0,10)}...`;
  });
  
  await test('Agent2 enter() on contract', async () => {
    const tx = await contract.connect(agent2Wallet).enter({ value: entryFee });
    await tx.wait();
    return `tx=${tx.hash.slice(0,10)}...`;
  });
  
  // Phase 4: API registration
  let agent1Key = '';
  let agent2Key = '';
  
  await test('Agent1 register via /enter API', async () => {
    const res = await fetch(`${API}/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: agent1Wallet.address, name: 'TestAgent1' }),
    });
    const data = await res.json();
    if (data.apiKey) {
      agent1Key = data.apiKey;
      return `name=TestAgent1`;
    }
    return false;
  });
  
  await test('Agent2 register via /enter API', async () => {
    const res = await fetch(`${API}/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: agent2Wallet.address, name: 'TestAgent2' }),
    });
    const data = await res.json();
    if (data.apiKey) {
      agent2Key = data.apiKey;
      return `name=TestAgent2`;
    }
    return false;
  });
  
  await sleep(1000);
  
  // Phase 5: Game actions
  await test('Agent1 look action', async () => {
    const res = await fetch(`${API}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': agent1Key },
      body: JSON.stringify({ action: 'look' }),
    });
    const data = await res.json();
    return data.success ? 'success' : false;
  });
  
  await test('Agent1 gather seaweed', async () => {
    const res = await fetch(`${API}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': agent1Key },
      body: JSON.stringify({ action: 'gather', target: 'seaweed' }),
    });
    const data = await res.json();
    return data.success ? 'gathered' : false;
  });
  
  await test('Agent2 move to trading_post', async () => {
    const res = await fetch(`${API}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': agent2Key },
      body: JSON.stringify({ action: 'move', target: 'trading_post' }),
    });
    const data = await res.json();
    return data.success ? 'moved' : false;
  });
  
  // Phase 6: Verify pools
  await test('Pools received entry fees', async () => {
    const nullPool = await contract.nullPool();
    const leviPool = await contract.leviathanPool();
    const total = Number(ethers.formatEther(nullPool)) + Number(ethers.formatEther(leviPool));
    return total > 0 ? `total=${total.toFixed(2)} MON` : false;
  });
  
  // Summary
  console.log('\n' + '='.repeat(40));
  const passed = results.filter(r => r.passed).length;
  console.log(`\n📊 Results: ${passed}/${results.length} passed\n`);
  
  if (passed < results.length) {
    console.log('❌ FAILED TESTS:');
    results.filter(r => !r.passed).forEach(r => console.log(`   - ${r.test}: ${r.detail || 'failed'}`));
  }
}

main().catch(console.error);
