#!/usr/bin/env npx tsx
/**
 * Analyze the specific payout transaction to understand exact amounts
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ABI = require('../abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';
const TX_HASH = '0xf6846e124ea0c3081a215693395dc1538afbabe60937b7aff5837e1649cef696';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     PAYOUT TRANSACTION ANALYSIS                   ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  
  console.log(`TX: ${TX_HASH}\n`);
  
  // Get transaction
  const tx = await provider.getTransaction(TX_HASH);
  if (!tx) {
    console.log('Transaction not found');
    return;
  }
  
  console.log('═══ TRANSACTION DETAILS ═══\n');
  console.log(`From: ${tx.from}`);
  console.log(`To: ${tx.to}`);
  console.log(`Block: ${tx.blockNumber}`);
  
  // Decode the function call
  const iface = new ethers.Interface(ABI);
  const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
  
  console.log(`\nFunction: ${decoded?.name}`);
  console.log(`Arguments:`);
  if (decoded?.args) {
    console.log(`  spawnId: ${decoded.args[0]}`);
    console.log(`  winners: ${JSON.stringify(decoded.args[1])}`);
    console.log(`  shares: ${decoded.args[2].map((s: bigint) => Number(s))}`);
    console.log(`  totalDamage: ${decoded.args[3]}`);
    
    // Calculate share percentages
    const shares = decoded.args[2].map((s: bigint) => Number(s));
    const totalShares = shares.reduce((a: number, b: number) => a + b, 0);
    console.log(`\n  Share breakdown:`);
    for (let i = 0; i < shares.length; i++) {
      const pct = (shares[i] / 10000 * 100).toFixed(2);
      console.log(`    ${decoded.args[1][i]}: ${shares[i]} bps (${pct}%)`);
    }
    console.log(`  Total shares: ${totalShares} bps (${(totalShares/100).toFixed(2)}%)`);
  }
  
  // Get receipt for events
  const receipt = await provider.getTransactionReceipt(TX_HASH);
  if (!receipt) {
    console.log('\nReceipt not found');
    return;
  }
  
  console.log('\n═══ EVENTS EMITTED ═══\n');
  
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed) {
        console.log(`Event: ${parsed.name}`);
        if (parsed.name === 'LeviathanRewardDistributed') {
          console.log(`  spawnId: ${parsed.args[0]}`);
          console.log(`  recipient: ${parsed.args[1]}`);
          console.log(`  amount: ${ethers.formatEther(parsed.args[2])} MON`);
          console.log(`  damageShare: ${parsed.args[3]} bps`);
        } else if (parsed.name === 'LeviathanKilled') {
          console.log(`  spawnId: ${parsed.args[0]}`);
          console.log(`  participantCount: ${parsed.args[1]}`);
          console.log(`  totalDamage: ${parsed.args[2]}`);
          console.log(`  poolAmount (distributed): ${ethers.formatEther(parsed.args[3])} MON`);
          console.log(`  poolUnlockBps: ${parsed.args[4]} (${Number(parsed.args[4])/100}%)`);
        }
        console.log('');
      }
    } catch {
      // Not our event
    }
  }
  
  // Calculate what pool must have been before
  console.log('═══ REVERSE CALCULATION ═══\n');
  
  // Sum up distributed amounts from events
  let totalDistributed = 0n;
  let unlockBps = 0n;
  
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === 'LeviathanRewardDistributed') {
        totalDistributed += parsed.args[2];
      }
      if (parsed?.name === 'LeviathanKilled') {
        unlockBps = parsed.args[4];
      }
    } catch {}
  }
  
  const distributedMon = parseFloat(ethers.formatEther(totalDistributed));
  const unlockPct = Number(unlockBps) / 100;
  
  console.log(`Total distributed: ${distributedMon.toFixed(6)} MON`);
  console.log(`Unlock percentage: ${unlockPct}%`);
  
  if (unlockBps > 0) {
    // availablePool = pool * unlockBps / 10000
    // So pool = distributedMon / (unlockBps / 10000)
    const impliedPoolBefore = distributedMon / (Number(unlockBps) / 10000);
    console.log(`\nImplied pool BEFORE kill: ${impliedPoolBefore.toFixed(6)} MON`);
    console.log(`(Because ${impliedPoolBefore.toFixed(4)} * ${unlockPct}% = ${distributedMon.toFixed(4)} MON)`);
  }
}

main().catch(console.error);
