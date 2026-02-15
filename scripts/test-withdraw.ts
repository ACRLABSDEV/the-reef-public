import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Testing Operations Withdrawal...\n');

  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, '../.wallet-testnet.json'), 'utf-8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../.deployment-testnet.json'), 'utf-8'));
  const contractJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json'), 'utf-8'));
  
  const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz/', { chainId: 10143, name: 'monad-testnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(deployment.contractAddress, contractJson.abi, wallet);
  const iface = new ethers.Interface(contractJson.abi);
  
  // Check ops pool before
  const [, , , opsBefore] = await contract.getPoolBalances();
  const walletBalBefore = await provider.getBalance(wallet.address);
  
  console.log(`📍 Contract: ${deployment.contractAddress}`);
  console.log(`💰 Ops Pool: ${ethers.formatEther(opsBefore)} MON`);
  console.log(`👛 Wallet Balance: ${ethers.formatEther(walletBalBefore)} MON\n`);
  
  if (opsBefore === 0n) {
    console.log('❌ No funds in ops pool to withdraw');
    return;
  }
  
  console.log('Withdrawing all ops funds...');
  
  // Use raw transaction approach
  const calldata = iface.encodeFunctionData('withdrawOperations', [wallet.address, 0n]); // 0 = withdraw all
  const feeData = await provider.getFeeData();
  const nonce = await provider.getTransactionCount(wallet.address);
  
  const tx = {
    to: deployment.contractAddress,
    value: 0n,
    data: calldata,
    gasLimit: 200000n,
    gasPrice: feeData.gasPrice,
    nonce: nonce,
    chainId: 10143,
  };
  
  const signedTx = await wallet.signTransaction(tx);
  const txResponse = await provider.broadcastTransaction(signedTx);
  console.log(`Tx: ${txResponse.hash}`);
  
  const receipt = await txResponse.wait();
  if (receipt?.status === 1) {
    console.log(`✅ Withdrawal successful! Gas: ${receipt.gasUsed}\n`);
    
    // Check after
    const [, , , opsAfter] = await contract.getPoolBalances();
    const walletBalAfter = await provider.getBalance(wallet.address);
    
    console.log(`💰 Ops Pool After: ${ethers.formatEther(opsAfter)} MON`);
    console.log(`👛 Wallet Balance After: ${ethers.formatEther(walletBalAfter)} MON`);
    console.log(`\n📈 Net received: ${ethers.formatEther(walletBalAfter - walletBalBefore + receipt.gasUsed * (feeData.gasPrice || 0n))} MON`);
    
    console.log('\n🎉 Withdrawal test PASSED!');
  } else {
    console.log(`❌ Withdrawal failed!`);
  }
}

main().catch(console.error);
