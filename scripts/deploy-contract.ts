import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monad Testnet Config
const MONAD_TESTNET = {
  rpc: 'https://testnet-rpc.monad.xyz/',
  chainId: 10143,
  explorer: 'https://testnet.monadexplorer.com',
};

// Entry fee: 0.1 MON (in wei)
const ENTRY_FEE = ethers.parseEther('0.1');

async function main() {
  console.log('🐚 The Reef - Contract Deployment');
  console.log('==================================\n');

  // Load wallet
  const walletPath = path.join(__dirname, '../.wallet-testnet.json');
  if (!fs.existsSync(walletPath)) {
    console.error('❌ No wallet found. Run test-contract.ts first.');
    process.exit(1);
  }
  
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const wallet = new ethers.Wallet(walletData.privateKey);
  console.log(`📍 Deployer: ${wallet.address}`);
  
  // Connect to Monad Testnet
  const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpc, {
    chainId: MONAD_TESTNET.chainId,
    name: 'monad-testnet',
  });
  
  const connectedWallet = wallet.connect(provider);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} MON`);
  
  if (balance < ethers.parseEther('0.01')) {
    console.error('\n❌ Insufficient balance for deployment. Need at least 0.01 MON.');
    console.log('   Get testnet tokens from: https://faucet.quicknode.com/monad/testnet\n');
    process.exit(1);
  }
  
  // Load contract ABI and bytecode
  const contractPath = path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json');
  if (!fs.existsSync(contractPath)) {
    console.error('❌ Contract not compiled. Run `cd contracts && forge build` first.');
    process.exit(1);
  }
  
  const contractJson = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
  const abi = contractJson.abi;
  const bytecode = contractJson.bytecode.object;
  
  console.log('\n📝 Deploying ReefTreasury...');
  console.log(`   Entry Fee: ${ethers.formatEther(ENTRY_FEE)} MON`);
  console.log(`   Backend: ${wallet.address} (deployer)`);
  
  // Deploy
  const factory = new ethers.ContractFactory(abi, bytecode, connectedWallet);
  const contract = await factory.deploy(ENTRY_FEE, wallet.address, {
    gasLimit: 3000000n, // Set explicit gas limit
  });
  
  console.log(`\n⏳ Waiting for deployment...`);
  console.log(`   Tx: ${contract.deploymentTransaction()?.hash}`);
  
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log(`\n✅ Contract deployed!`);
  console.log(`   Address: ${address}`);
  console.log(`   Explorer: ${MONAD_TESTNET.explorer}/address/${address}`);
  
  // Save deployment info
  const deploymentPath = path.join(__dirname, '../.deployment-testnet.json');
  fs.writeFileSync(deploymentPath, JSON.stringify({
    network: 'monad-testnet',
    chainId: MONAD_TESTNET.chainId,
    contractAddress: address,
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    entryFee: ENTRY_FEE.toString(),
    txHash: contract.deploymentTransaction()?.hash,
  }, null, 2));
  
  console.log(`\n📁 Deployment saved to .deployment-testnet.json`);
  console.log('\n🎉 Next steps:');
  console.log('   1. Set REEF_CONTRACT_ADDRESS in Railway env');
  console.log('   2. Set MONAD_RPC_URL=https://testnet-rpc.monad.xyz/');
  console.log('   3. Run test-contract.ts to verify functionality');
}

main().catch(console.error);
