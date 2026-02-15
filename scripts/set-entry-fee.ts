import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const ABI = require('../src/abi/ReefTreasury.json');
const CONTRACT = '0xCc5135fca944c3b267517A7E46E97A06FA27B97A';
const RPC = 'https://rpc.monad.xyz';
const NEW_FEE = ethers.parseEther('10'); // 10 MON

async function main() {
  const walletData = JSON.parse(readFileSync('/data/.secrets/reef-mainnet-wallet.json', 'utf-8'));
  const provider = new ethers.JsonRpcProvider(RPC, { chainId: 143, name: 'monad-mainnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(CONTRACT, ABI, wallet);
  
  console.log('🔧 Setting base entry fee to 10 MON...');
  
  const currentFee = await contract.baseEntryFee();
  console.log(`Current: ${ethers.formatEther(currentFee)} MON`);
  
  const tx = await contract.setBaseEntryFee(NEW_FEE);
  console.log(`TX: ${tx.hash}`);
  await tx.wait();
  
  const newFee = await contract.baseEntryFee();
  console.log(`New: ${ethers.formatEther(newFee)} MON`);
  console.log('✅ Done!');
}

main().catch(console.error);
