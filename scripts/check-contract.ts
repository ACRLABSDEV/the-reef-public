#!/usr/bin/env npx tsx
/**
 * Check contract state and recent events
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ABI = require('../src/abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  console.log('═══════════════════════════════════════');
  console.log('📋 CONTRACT STATE');
  console.log('═══════════════════════════════════════\n');
  
  // Pool balances
  const [nullPool, leviathanPool, tournamentPool, opsPool] = await Promise.all([
    contract.nullPool(),
    contract.leviathanPool(),
    contract.tournamentPool(),
    contract.operationsPool(),
  ]);
  
  console.log('Pool Balances:');
  console.log(`  Null:       ${ethers.formatEther(nullPool)} MON`);
  console.log(`  Leviathan:  ${ethers.formatEther(leviathanPool)} MON`);
  console.log(`  Tournament: ${ethers.formatEther(tournamentPool)} MON`);
  console.log(`  Operations: ${ethers.formatEther(opsPool)} MON`);
  
  // Spawn counts
  const [levSpawnCount, tourneyCount] = await Promise.all([
    contract.leviathanSpawnCount(),
    contract.tournamentCount(),
  ]);
  
  console.log('\nCounters:');
  console.log(`  Leviathan Spawns: ${levSpawnCount}`);
  console.log(`  Tournaments: ${tourneyCount}`);
  
  // Check recent events
  console.log('\n═══════════════════════════════════════');
  console.log('📜 RECENT EVENTS (last 1000 blocks)');
  console.log('═══════════════════════════════════════\n');
  
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 1000);
  
  // Get LeviathanRewardDistributed events
  const levFilter = contract.filters.LeviathanRewardDistributed();
  const levEvents = await contract.queryFilter(levFilter, fromBlock, currentBlock);
  
  console.log(`LeviathanRewardDistributed events: ${levEvents.length}`);
  for (const event of levEvents) {
    const args = (event as any).args;
    console.log(`  Block ${event.blockNumber}: spawnId=${args.spawnId}, totalAmount=${ethers.formatEther(args.totalAmount)} MON`);
  }
  
  // Get AgentEntered events
  const enterFilter = contract.filters.AgentEntered();
  const enterEvents = await contract.queryFilter(enterFilter, fromBlock, currentBlock);
  
  console.log(`\nAgentEntered events: ${enterEvents.length}`);
  for (const event of enterEvents.slice(-5)) { // Last 5
    const args = (event as any).args;
    console.log(`  Block ${event.blockNumber}: ${args.agent} paid ${ethers.formatEther(args.amount)} MON`);
  }
  
  console.log('\n✅ Done');
}

main().catch(console.error);
