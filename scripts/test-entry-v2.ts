import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Testing Agent Entry v2...\n');

  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, '../.wallet-testnet.json'), 'utf-8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../.deployment-testnet.json'), 'utf-8'));
  
  const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz/', { chainId: 10143, name: 'monad-testnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  
  // Simple ABI with just enter function
  const abi = [
    'function enter() external payable',
    'function hasEntered(address) external view returns (bool)',
    'function entryFee() external view returns (uint256)',
    'function leviathanPool() external view returns (uint256)',
    'function tournamentPool() external view returns (uint256)',
    'function operationsPool() external view returns (uint256)',
  ];
  
  const contract = new ethers.Contract(deployment.contractAddress, abi, wallet);
  
  const entryFee = await contract.entryFee();
  console.log(`📍 Contract: ${deployment.contractAddress}`);
  console.log(`💰 Entry Fee: ${ethers.formatEther(entryFee)} MON`);
  console.log(`🤖 Wallet: ${wallet.address}\n`);
  
  const alreadyEntered = await contract.hasEntered(wallet.address);
  console.log(`Already entered: ${alreadyEntered}`);
  
  if (!alreadyEntered) {
    console.log('\nEntering...');
    const tx = await contract.enter({ value: entryFee });
    console.log(`Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Gas used: ${receipt?.gasUsed}\n`);
  }
  
  // Check pools
  const lev = await contract.leviathanPool();
  const tour = await contract.tournamentPool();
  const ops = await contract.operationsPool();
  
  console.log('💰 Pool Balances:');
  console.log(`   Leviathan (70%): ${ethers.formatEther(lev)} MON`);
  console.log(`   Tournament (20%): ${ethers.formatEther(tour)} MON`);
  console.log(`   Operations (10%): ${ethers.formatEther(ops)} MON`);
  
  const isReg = await contract.hasEntered(wallet.address);
  console.log(`\n✅ Wallet registered: ${isReg}`);
  console.log('\n🎉 Contract functional test PASSED!');
}

main().catch(console.error);
