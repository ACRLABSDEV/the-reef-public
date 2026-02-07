import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🔍 Debugging Contract State...\n');

  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, '../.wallet-testnet.json'), 'utf-8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../.deployment-testnet.json'), 'utf-8'));
  const contractJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json'), 'utf-8'));
  
  const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz/', { chainId: 10143, name: 'monad-testnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(deployment.contractAddress, contractJson.abi, wallet);
  
  console.log(`Contract: ${deployment.contractAddress}`);
  console.log(`Wallet: ${wallet.address}\n`);
  
  // Check all view functions
  try {
    const paused = await contract.paused();
    console.log(`Paused: ${paused}`);
  } catch (e: any) {
    console.log(`Paused: ERROR - ${e.message}`);
  }
  
  try {
    const owner = await contract.owner();
    console.log(`Owner: ${owner}`);
    console.log(`Is owner: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
  } catch (e: any) {
    console.log(`Owner: ERROR - ${e.message}`);
  }
  
  try {
    const backend = await contract.backend();
    console.log(`Backend: ${backend}`);
  } catch (e: any) {
    console.log(`Backend: ERROR - ${e.message}`);
  }
  
  try {
    const baseEntryFee = await contract.baseEntryFee();
    console.log(`Base Entry Fee: ${ethers.formatEther(baseEntryFee)} MON`);
  } catch (e: any) {
    console.log(`Base Entry Fee: ERROR - ${e.message}`);
  }
  
  try {
    const currentFee = await contract.getCurrentEntryFee();
    console.log(`Current Entry Fee: ${ethers.formatEther(currentFee)} MON`);
  } catch (e: any) {
    console.log(`Current Entry Fee: ERROR - ${e.message}`);
  }
  
  try {
    const hasEntered = await contract.hasEntered(wallet.address);
    console.log(`Has Entered: ${hasEntered}`);
  } catch (e: any) {
    console.log(`Has Entered: ERROR - ${e.message}`);
  }
  
  try {
    const seasonInfo = await contract.getSeasonInfo();
    console.log(`Season Info: season=${seasonInfo.season}, day=${seasonInfo.day}, fee=${ethers.formatEther(seasonInfo.entryFee)}, unlock=${seasonInfo.poolUnlockBps}bps`);
  } catch (e: any) {
    console.log(`Season Info: ERROR - ${e.message}`);
  }
  
  // Check wallet balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`\nWallet Balance: ${ethers.formatEther(balance)} MON`);
  
  // Try static call to simulate enter()
  console.log('\n🧪 Simulating enter() with staticCall...');
  try {
    const currentFee = await contract.getCurrentEntryFee();
    await contract.enter.staticCall({ value: currentFee });
    console.log('✅ staticCall succeeded - enter() should work');
  } catch (e: any) {
    console.log(`❌ staticCall failed: ${e.message}`);
    if (e.data) console.log(`   Data: ${e.data}`);
    if (e.reason) console.log(`   Reason: ${e.reason}`);
  }
  
  // Try with estimateGas
  console.log('\n🧪 Estimating gas for enter()...');
  try {
    const currentFee = await contract.getCurrentEntryFee();
    const gas = await contract.enter.estimateGas({ value: currentFee });
    console.log(`✅ Estimated gas: ${gas}`);
  } catch (e: any) {
    console.log(`❌ estimateGas failed: ${e.message}`);
  }
  
  // Try direct call data
  console.log('\n🧪 Raw transaction details...');
  const iface = new ethers.Interface(contractJson.abi);
  const calldata = iface.encodeFunctionData('enter', []);
  console.log(`Calldata: ${calldata}`);
  console.log(`Calldata length: ${calldata.length}`);
}

main().catch(console.error);
