#!/usr/bin/env npx tsx
/**
 * Fix Squad agent wallets:
 * 1. Generate new wallets
 * 2. Fund them from backend wallet
 * 3. Have them call enter() on contract
 * 4. Update DB
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const ABI = require('../src/abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';
const ENTRY_FEE = '0.1'; // MON

// Backend wallet (has funds for gas + entry fees)
const BACKEND_KEY = process.env.BACKEND_PRIVATE_KEY;
if (!BACKEND_KEY) {
  console.error('Set BACKEND_PRIVATE_KEY env var');
  process.exit(1);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const SQUAD_AGENTS = [
  { name: 'SquadBravo', oldWallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2' },
  { name: 'SquadCharlie', oldWallet: '0x28c3f3872f7966e0df8701ad004a4af19b2744d7' },
  { name: 'SquadDelta', oldWallet: '0xde17a44444444444444444444444444444444444' },
];

// Already done:
// SquadAlpha: 0xa55D3174525d65a7f2563c43610754403c8dCd3f

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const backendWallet = new ethers.Wallet(BACKEND_KEY, provider);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  console.log(`Backend wallet: ${backendWallet.address}`);
  const balance = await provider.getBalance(backendWallet.address);
  console.log(`Backend balance: ${ethers.formatEther(balance)} MON\n`);
  
  const results = [];
  
  for (const agent of SQUAD_AGENTS) {
    console.log(`\n═══ ${agent.name} ═══`);
    
    // Generate new wallet
    const newWallet = ethers.Wallet.createRandom().connect(provider);
    console.log(`New wallet: ${newWallet.address}`);
    console.log(`Private key: ${newWallet.privateKey}`);
    
    // Fund it (entry fee + gas)
    const fundAmount = ethers.parseEther('0.15'); // 0.1 entry + 0.05 gas
    console.log(`Funding with 0.15 MON...`);
    
    await sleep(3000); // Rate limit
    const fundTx = await backendWallet.sendTransaction({
      to: newWallet.address,
      value: fundAmount,
    });
    await fundTx.wait();
    console.log(`Funded: ${fundTx.hash}`);
    
    // Call enter()
    console.log(`Calling enter()...`);
    const entryFee = ethers.parseEther(ENTRY_FEE);
    const contractWithSigner = contract.connect(newWallet);
    
    await sleep(3000); // Rate limit
    const enterTx = await contractWithSigner.enter({ value: entryFee });
    await enterTx.wait();
    console.log(`Entered: ${enterTx.hash}`);
    
    // Verify
    await sleep(2000); // Rate limit
    const isEntered = await contract.hasEntered(newWallet.address);
    console.log(`Verified on contract: ${isEntered ? '✅' : '❌'}`);
    
    results.push({
      name: agent.name,
      oldWallet: agent.oldWallet,
      newWallet: newWallet.address,
      privateKey: newWallet.privateKey,
    });
    
    await sleep(3000); // Rate limit between agents
  }
  
  // Note: SquadAlpha was already migrated separately
  
  console.log('\n═══════════════════════════════════════');
  console.log('RESULTS - Update these in DB:');
  console.log('═══════════════════════════════════════\n');
  
  for (const r of results) {
    console.log(`UPDATE agents SET wallet = '${r.newWallet.toLowerCase()}' WHERE wallet = '${r.oldWallet.toLowerCase()}';`);
  }
  
  // Save to file
  fs.writeFileSync('/tmp/squad-wallets.json', JSON.stringify(results, null, 2));
  console.log('\nSaved to /tmp/squad-wallets.json');
}

main().catch(console.error);
