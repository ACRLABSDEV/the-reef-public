#!/usr/bin/env npx tsx
import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ABI = require('../src/abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';
const ENTRY_FEE = '0.1';
const BACKEND_KEY = process.env.BACKEND_PRIVATE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!BACKEND_KEY || !ADMIN_KEY) {
  console.error('Set BACKEND_PRIVATE_KEY and ADMIN_KEY env vars');
  process.exit(1);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const REMAINING = [
  { name: 'SquadCharlie', oldWallet: '0x28c3f3872f7966e0df8701ad004a4af19b2744d7' },
  { name: 'SquadDelta', oldWallet: '0xde17a44444444444444444444444444444444444' },
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const backendWallet = new ethers.Wallet(BACKEND_KEY!, provider);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  console.log(`Backend: ${backendWallet.address}`);
  console.log(`Balance: ${ethers.formatEther(await provider.getBalance(backendWallet.address))} MON\n`);
  
  for (const agent of REMAINING) {
    console.log(`\n═══ ${agent.name} ═══`);
    
    const newWallet = ethers.Wallet.createRandom().connect(provider);
    console.log(`New wallet: ${newWallet.address}`);
    
    // Fund
    await sleep(2000);
    const fundTx = await backendWallet.sendTransaction({
      to: newWallet.address,
      value: ethers.parseEther('0.15'),
    });
    await fundTx.wait();
    console.log(`Funded ✅`);
    
    // Enter
    await sleep(2000);
    const enterTx = await contract.connect(newWallet).enter({ value: ethers.parseEther(ENTRY_FEE) });
    await enterTx.wait();
    console.log(`Entered ✅`);
    
    // Verify
    await sleep(1000);
    const ok = await contract.hasEntered(newWallet.address);
    console.log(`Verified: ${ok ? '✅' : '❌'}`);
    
    // Update DB via API
    await sleep(1000);
    const resp = await fetch('https://thereef.co/enter/admin/update-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY! },
      body: JSON.stringify({ name: agent.name, wallet: newWallet.address }),
    });
    const result = await resp.json();
    console.log(`DB updated: ${result.success ? '✅' : '❌ ' + result.error}`);
    
    await sleep(2000);
  }
  
  console.log('\n✅ All Squad agents fixed!');
}

main().catch(console.error);
