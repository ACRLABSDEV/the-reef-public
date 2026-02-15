#!/usr/bin/env npx tsx
import { ethers } from 'ethers';
const RPC = 'https://testnet-rpc.monad.xyz';
const provider = new ethers.JsonRpcProvider(RPC);
async function main() {
  const balance = await provider.getBalance('0x33d30A6c06dc4a30a715D0e1a5C8e7422111a36F');
  console.log('Backend balance:', ethers.formatEther(balance), 'MON');
}
main();
