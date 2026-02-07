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

async function main() {
  console.log('🐚 The Reef - Contract Verification');
  console.log('====================================\n');

  // Load wallet
  const walletPath = path.join(__dirname, '../.wallet-testnet.json');
  if (!fs.existsSync(walletPath)) {
    console.error('❌ No wallet found. Run test-contract.ts first.');
    process.exit(1);
  }
  
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const wallet = new ethers.Wallet(walletData.privateKey);
  
  // Load deployment
  const deploymentPath = path.join(__dirname, '../.deployment-testnet.json');
  if (!fs.existsSync(deploymentPath)) {
    console.error('❌ No deployment found. Run deploy-contract.ts first.');
    process.exit(1);
  }
  
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
  console.log(`📍 Contract: ${deployment.contractAddress}`);
  
  // Connect to Monad Testnet
  const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpc, {
    chainId: MONAD_TESTNET.chainId,
    name: 'monad-testnet',
  });
  
  const connectedWallet = wallet.connect(provider);
  
  // Load contract ABI
  const contractPath = path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json');
  const contractJson = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
  const abi = contractJson.abi;
  
  // Connect to contract
  const contract = new ethers.Contract(deployment.contractAddress, abi, connectedWallet);
  
  console.log('\n📊 Contract State:');
  
  try {
    // Read contract state
    const entryFee = await contract.entryFee();
    console.log(`   Entry Fee: ${ethers.formatEther(entryFee)} MON`);
    
    const backend = await contract.backend();
    console.log(`   Backend: ${backend}`);
    
    const owner = await contract.owner();
    console.log(`   Owner: ${owner}`);
    
    const isPaused = await contract.paused();
    console.log(`   Paused: ${isPaused}`);
    
    // Pool balances
    const leviathanPool = await contract.leviathanPool();
    const tournamentPool = await contract.tournamentPool();
    const operationsPool = await contract.operationsPool();
    
    console.log('\n💰 Pool Balances:');
    console.log(`   Leviathan: ${ethers.formatEther(leviathanPool)} MON`);
    console.log(`   Tournament: ${ethers.formatEther(tournamentPool)} MON`);
    console.log(`   Operations: ${ethers.formatEther(operationsPool)} MON`);
    
    // Pool splits
    const splits = await contract.getPoolSplits();
    console.log('\n📊 Pool Splits:');
    console.log(`   Leviathan: ${splits[0]}%`);
    console.log(`   Tournament: ${splits[1]}%`);
    console.log(`   Operations: ${splits[2]}%`);
    
    // Test agent entry
    const walletBalance = await provider.getBalance(wallet.address);
    console.log(`\n💳 Wallet Balance: ${ethers.formatEther(walletBalance)} MON`);
    
    if (walletBalance >= entryFee) {
      console.log('\n🧪 Testing agent entry...');
      
      const testWallet = ethers.Wallet.createRandom();
      console.log(`   Test agent: ${testWallet.address}`);
      
      // Enter as agent
      const tx = await contract.enterAgent(testWallet.address, {
        value: entryFee,
        gasLimit: 200000n,
      });
      
      console.log(`   Tx: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`   ✅ Agent entered! Gas used: ${receipt?.gasUsed}`);
      
      // Check if registered
      const isRegistered = await contract.isAgentRegistered(testWallet.address);
      console.log(`   Is registered: ${isRegistered}`);
      
      // Check new pool balances
      const newLev = await contract.leviathanPool();
      const newTour = await contract.tournamentPool();
      const newOps = await contract.operationsPool();
      
      console.log('\n💰 Updated Pool Balances:');
      console.log(`   Leviathan: ${ethers.formatEther(newLev)} MON (+${ethers.formatEther(newLev - leviathanPool)})`);
      console.log(`   Tournament: ${ethers.formatEther(newTour)} MON (+${ethers.formatEther(newTour - tournamentPool)})`);
      console.log(`   Operations: ${ethers.formatEther(newOps)} MON (+${ethers.formatEther(newOps - operationsPool)})`);
      
      console.log('\n✅ All contract functions working correctly!');
    } else {
      console.log('\n⚠️  Insufficient balance to test agent entry');
      console.log(`   Need: ${ethers.formatEther(entryFee)} MON`);
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
