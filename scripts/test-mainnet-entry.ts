import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const ABI = require('../src/abi/ReefTreasury.json');
const CONTRACT = '0xCc5135fca944c3b267517A7E46E97A06FA27B97A';
const RPC = 'https://rpc.monad.xyz';

async function main() {
  const walletData = JSON.parse(readFileSync('/data/.secrets/reef-mainnet-wallet.json', 'utf-8'));
  
  const provider = new ethers.JsonRpcProvider(RPC, { chainId: 143, name: 'monad-mainnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(CONTRACT, ABI, provider);
  
  console.log('🔍 Checking mainnet contract state...');
  console.log(`Wallet: ${wallet.address}`);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} MON`);
  
  const entryFee = await contract.getCurrentEntryFee();
  console.log(`Entry fee: ${ethers.formatEther(entryFee)} MON`);
  
  const hasEntered = await contract.hasEntered(wallet.address);
  console.log(`Already entered: ${hasEntered}`);
  
  if (hasEntered) {
    console.log('✅ Wallet already registered in contract');
  } else {
    console.log('\n🚀 Calling enter()...');
    const tx = await contract.connect(wallet).enter({ value: entryFee });
    console.log(`TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
  }
  
  // Check pools
  const nullPool = await contract.nullPool();
  const leviPool = await contract.leviathanPool();
  const tourneyPool = await contract.tournamentPool();
  const opsPool = await contract.operationsPool();
  
  console.log('\n📊 Pool balances:');
  console.log(`  Null: ${ethers.formatEther(nullPool)} MON`);
  console.log(`  Levi: ${ethers.formatEther(leviPool)} MON`);
  console.log(`  Tourney: ${ethers.formatEther(tourneyPool)} MON`);
  console.log(`  Ops: ${ethers.formatEther(opsPool)} MON`);
}

main().catch(console.error);
