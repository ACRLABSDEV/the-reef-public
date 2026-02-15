#!/usr/bin/env npx tsx
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monad Mainnet Config
const MONAD_MAINNET = {
  rpc: 'https://rpc.monad.xyz',
  chainId: 143,
  explorer: 'https://monadvision.com',
};

// Entry fee: 50 MON (~$1) - configurable via setBaseEntryFee after deployment
const ENTRY_FEE = ethers.parseEther('50');

async function main() {
  console.log('🐚 The Reef - MAINNET Contract Deployment');
  console.log('==========================================\n');

  // Load wallet from secrets
  const walletPath = '/data/.secrets/reef-mainnet-wallet.json';
  if (!fs.existsSync(walletPath)) {
    console.error('❌ No mainnet wallet found at', walletPath);
    process.exit(1);
  }
  
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const wallet = new ethers.Wallet(walletData.privateKey);
  console.log(`📍 Deployer: ${wallet.address}`);
  
  // Connect to Monad Mainnet
  const provider = new ethers.JsonRpcProvider(MONAD_MAINNET.rpc, {
    chainId: MONAD_MAINNET.chainId,
    name: 'monad-mainnet',
  });
  
  const connectedWallet = wallet.connect(provider);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} MON`);
  
  if (balance < ethers.parseEther('1')) {
    console.error('\n❌ Insufficient balance for deployment. Need at least 1 MON.');
    process.exit(1);
  }

  // Load contract ABI and bytecode
  const abiPath = path.join(__dirname, '../src/abi/ReefTreasury.json');
  const bytecodePath = path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json');
  
  if (!fs.existsSync(abiPath)) {
    console.error('❌ ABI not found at', abiPath);
    process.exit(1);
  }
  
  if (!fs.existsSync(bytecodePath)) {
    console.error('❌ Bytecode not found. Run: cd contracts && forge build');
    process.exit(1);
  }
  
  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));
  const bytecodeData = JSON.parse(fs.readFileSync(bytecodePath, 'utf-8'));
  const bytecode = bytecodeData.bytecode.object;

  console.log(`\n📋 Contract Settings:`);
  console.log(`   Base Entry Fee: ${ethers.formatEther(ENTRY_FEE)} MON`);
  console.log(`   Backend Address: ${wallet.address} (same as deployer)`);
  console.log(`   Network: Monad Mainnet (Chain ID: ${MONAD_MAINNET.chainId})`);
  
  console.log('\n🚀 Deploying contract...');
  
  // Deploy
  const factory = new ethers.ContractFactory(abi, bytecode, connectedWallet);
  const contract = await factory.deploy(ENTRY_FEE, wallet.address);
  
  console.log(`📝 TX Hash: ${contract.deploymentTransaction()?.hash}`);
  console.log('⏳ Waiting for confirmation...');
  
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  
  console.log(`\n✅ Contract deployed!`);
  console.log(`📍 Address: ${contractAddress}`);
  console.log(`🔗 Explorer: ${MONAD_MAINNET.explorer}/address/${contractAddress}`);
  
  // Save deployment info
  const deploymentInfo = {
    network: 'monad-mainnet',
    chainId: MONAD_MAINNET.chainId,
    contractAddress,
    deployerAddress: wallet.address,
    backendAddress: wallet.address,
    baseEntryFee: ethers.formatEther(ENTRY_FEE),
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash,
  };
  
  const deploymentPath = '/data/.secrets/reef-mainnet-deployment.json';
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment saved to: ${deploymentPath}`);
  
  // Verify contract state
  console.log('\n🔍 Verifying contract state...');
  const deployedContract = new ethers.Contract(contractAddress, abi, provider);
  
  const owner = await deployedContract.owner();
  const backend = await deployedContract.backend();
  const entryFee = await deployedContract.baseEntryFee();
  
  console.log(`   Owner: ${owner}`);
  console.log(`   Backend: ${backend}`);
  console.log(`   Base Entry Fee: ${ethers.formatEther(entryFee)} MON`);
  
  console.log('\n🎉 MAINNET DEPLOYMENT COMPLETE!');
  console.log('\n📋 Next steps:');
  console.log('   1. Set REEF_CONTRACT_ADDRESS in Railway env vars');
  console.log('   2. Set BACKEND_PRIVATE_KEY in Railway env vars');
  console.log('   3. Set MONAD_RPC_URL=https://rpc.monad.xyz');
  console.log('   4. Fresh DB (delete data/reef.db before deploy)');
  console.log('   5. Push to Railway');
}

main().catch(console.error);
