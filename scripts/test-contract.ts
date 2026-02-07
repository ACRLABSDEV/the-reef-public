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
  console.log('🐚 The Reef - Smart Contract Testing');
  console.log('=====================================\n');

  // Create or load wallet
  const walletPath = path.join(__dirname, '../.wallet-testnet.json');
  let wallet: ethers.Wallet;
  
  if (fs.existsSync(walletPath)) {
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    wallet = new ethers.Wallet(walletData.privateKey);
    console.log('📂 Loaded existing wallet');
  } else {
    wallet = ethers.Wallet.createRandom();
    fs.writeFileSync(walletPath, JSON.stringify({
      address: wallet.address,
      privateKey: wallet.privateKey,
    }, null, 2));
    console.log('✨ Created new wallet');
  }
  
  console.log(`📍 Wallet Address: ${wallet.address}`);
  console.log(`🔗 Explorer: ${MONAD_TESTNET.explorer}/address/${wallet.address}\n`);
  
  // Connect to Monad Testnet
  const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpc, {
    chainId: MONAD_TESTNET.chainId,
    name: 'monad-testnet',
  });
  
  const connectedWallet = wallet.connect(provider);
  
  // Check balance
  try {
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = ethers.formatEther(balance);
    console.log(`💰 Balance: ${balanceEth} MON`);
    
    if (balance === 0n) {
      console.log('\n⚠️  No MON! Get testnet tokens from:');
      console.log('   - https://faucet.quicknode.com/monad/testnet');
      console.log('   - https://faucet.monad.xyz/');
      console.log('\n   Then run this script again.\n');
      return;
    }
    
    // Check network
    const network = await provider.getNetwork();
    console.log(`🌐 Connected to chain: ${network.chainId}\n`);
    
    // TODO: Deploy contract or interact with deployed one
    console.log('✅ Wallet ready for contract deployment/testing');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
