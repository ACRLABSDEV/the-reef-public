#!/usr/bin/env npx tsx
import { ethers } from 'ethers';

const RPC = 'https://testnet-rpc.monad.xyz';
const provider = new ethers.JsonRpcProvider(RPC);

const SQUAD_WALLETS = [
  { name: 'SquadAlpha', wallet: '0xa55D3174525d65a7f2563c43610754403c8dCd3f' },
  { name: 'SquadBravo', wallet: '0x90707e680B4A95be3a82A98643147025AE1360Cd' },
  { name: 'SquadCharlie', wallet: '0xc73A9918B7C84Bc5AB910B5Cb139786Ea9aeA1f1' },
  { name: 'SquadDelta', wallet: '0xe1bd845bCe8E68067f7efeb3432222bA1E4ADd8D' },
];

async function main() {
  console.log('Squad Agent Balances:\n');
  for (const s of SQUAD_WALLETS) {
    const balance = await provider.getBalance(s.wallet);
    console.log(`${s.name}: ${ethers.formatEther(balance)} MON`);
  }
}
main();
