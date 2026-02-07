import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Testing Entry with Raw Transaction...\n');

  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, '../.wallet-testnet.json'), 'utf-8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../.deployment-testnet.json'), 'utf-8'));
  const contractJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json'), 'utf-8'));
  
  const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz/', { chainId: 10143, name: 'monad-testnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  
  const iface = new ethers.Interface(contractJson.abi);
  const calldata = iface.encodeFunctionData('enter', []);
  const entryFee = ethers.parseEther('0.1');
  
  console.log(`Contract: ${deployment.contractAddress}`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Entry Fee: ${ethers.formatEther(entryFee)} MON`);
  console.log(`Calldata: ${calldata}\n`);
  
  // Get gas price
  const feeData = await provider.getFeeData();
  console.log(`Gas Price: ${feeData.gasPrice?.toString()} wei`);
  
  // Build raw transaction
  const nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Nonce: ${nonce}`);
  
  const tx = {
    to: deployment.contractAddress,
    value: entryFee,
    data: calldata,
    gasLimit: 500000n,
    gasPrice: feeData.gasPrice,
    nonce: nonce,
    chainId: 10143,
  };
  
  console.log('\n📝 Transaction:');
  console.log(JSON.stringify(tx, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  
  console.log('\n⏳ Sending transaction...');
  const signedTx = await wallet.signTransaction(tx);
  console.log(`Signed tx length: ${signedTx.length}`);
  
  const txResponse = await provider.broadcastTransaction(signedTx);
  console.log(`Tx Hash: ${txResponse.hash}`);
  
  console.log('Waiting for confirmation...');
  const receipt = await txResponse.wait();
  
  console.log(`\nStatus: ${receipt?.status}`);
  console.log(`Gas Used: ${receipt?.gasUsed}`);
  console.log(`Logs: ${receipt?.logs.length}`);
  
  if (receipt?.status === 1) {
    console.log('\n✅ Transaction succeeded!');
    
    // Check pools
    const contract = new ethers.Contract(deployment.contractAddress, contractJson.abi, wallet);
    const [nullPool, leviPool, tourPool, opsPool] = await contract.getPoolBalances();
    console.log('\n💰 Pool Balances:');
    console.log(`   Null (40%):       ${ethers.formatEther(nullPool)} MON`);
    console.log(`   Leviathan (30%):  ${ethers.formatEther(leviPool)} MON`);
    console.log(`   Tournament (20%): ${ethers.formatEther(tourPool)} MON`);
    console.log(`   Operations (10%): ${ethers.formatEther(opsPool)} MON`);
  } else {
    console.log('\n❌ Transaction reverted!');
  }
}

main().catch(console.error);
