import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONAD_TESTNET = {
  rpc: 'https://testnet-rpc.monad.xyz/',
  chainId: 10143,
};

async function main() {
  console.log('🧪 Testing Agent Entry...\n');

  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, '../.wallet-testnet.json'), 'utf-8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../.deployment-testnet.json'), 'utf-8'));
  const contractJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json'), 'utf-8'));
  
  const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpc, { chainId: MONAD_TESTNET.chainId, name: 'monad-testnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(deployment.contractAddress, contractJson.abi, wallet);
  const iface = new ethers.Interface(contractJson.abi);
  
  // Get season info
  const seasonInfo = await contract.getSeasonInfo();
  const entryFee = seasonInfo.entryFee;
  
  console.log(`📍 Contract: ${deployment.contractAddress}`);
  console.log(`🗓️  Season: ${seasonInfo.season.toString()}, Day: ${seasonInfo.day.toString()}`);
  console.log(`💰 Entry Fee Today: ${ethers.formatEther(entryFee)} MON`);
  console.log(`📊 Pool Unlock: ${Number(seasonInfo.poolUnlockBps) / 100}%`);
  console.log(`🤖 Entering as: ${wallet.address}\n`);
  
  // Check if already entered this season
  const alreadyEntered = await contract.hasEntered(wallet.address);
  if (alreadyEntered) {
    console.log('⚠️  Wallet already entered this season.\n');
  } else {
    console.log('Entering with raw transaction...');
    
    // Use raw transaction approach (more reliable on Monad)
    const calldata = iface.encodeFunctionData('enter', []);
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(wallet.address);
    
    const tx = {
      to: deployment.contractAddress,
      value: entryFee,
      data: calldata,
      gasLimit: 500000n,
      gasPrice: feeData.gasPrice,
      nonce: nonce,
      chainId: MONAD_TESTNET.chainId,
    };
    
    const signedTx = await wallet.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log(`Tx: ${txResponse.hash}`);
    
    const receipt = await txResponse.wait();
    if (receipt?.status === 1) {
      console.log(`✅ Entry successful! Gas: ${receipt.gasUsed}\n`);
    } else {
      console.log(`❌ Entry failed!\n`);
      return;
    }
  }
  
  // Check pools (new 4-way split)
  const [nullPool, leviPool, tourPool, opsPool] = await contract.getPoolBalances();
  
  console.log('💰 Pool Balances (40/30/20/10 split):');
  console.log(`   Null (40%):       ${ethers.formatEther(nullPool)} MON`);
  console.log(`   Leviathan (30%):  ${ethers.formatEther(leviPool)} MON`);
  console.log(`   Tournament (20%): ${ethers.formatEther(tourPool)} MON`);
  console.log(`   Operations (10%): ${ethers.formatEther(opsPool)} MON`);
  
  // Check registration
  const isReg = await contract.hasEntered(wallet.address);
  console.log(`\n✅ Wallet registered: ${isReg}`);
  
  // Get stats
  const stats = await contract.getStats();
  console.log(`\n📊 Contract Stats:`);
  console.log(`   Total Agents: ${stats.agents.toString()}`);
  console.log(`   Total Collected: ${ethers.formatEther(stats.collected)} MON`);
  console.log(`   Total Distributed: ${ethers.formatEther(stats.distributed)} MON`);
  console.log(`   Current Season: ${stats.season.toString()}`);
  
  console.log('\n🎉 Contract test PASSED!');
}

main().catch(console.error);
