#!/usr/bin/env npx tsx
import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ABI = require('../src/abi/ReefTreasury.json');

const CONTRACT = '0xD819C926A878D3886392ae1B238c629Bb07D996a';
const RPC = 'https://testnet-rpc.monad.xyz';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  const currentBlock = await provider.getBlockNumber();
  
  // Query in small batches (100 blocks max on Monad)
  console.log('Searching for AgentEntered events...');
  
  const allEvents = [];
  for (let from = currentBlock - 10000; from < currentBlock; from += 100) {
    const to = Math.min(from + 99, currentBlock);
    try {
      const filter = contract.filters.AgentEntered();
      const events = await contract.queryFilter(filter, from, to);
      allEvents.push(...events);
    } catch (e) {
      // Skip errors
    }
  }
  
  console.log(`\nFound ${allEvents.length} AgentEntered events:`);
  for (const event of allEvents) {
    const args = (event as any).args;
    console.log(`  ${args.agent} paid ${ethers.formatEther(args.amount)} MON`);
  }
}
main().catch(console.error);
