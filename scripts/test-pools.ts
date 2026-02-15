import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 The Reef - Pool & Admin Function Testing');
  console.log('=============================================\n');

  // Load configs
  const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, '../.wallet-testnet.json'), 'utf-8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../.deployment-testnet.json'), 'utf-8'));
  const contractJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/out/ReefTreasury.sol/ReefTreasury.json'), 'utf-8'));
  
  // Connect
  const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz/', { chainId: 10143, name: 'monad-testnet' });
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  const contract = new ethers.Contract(deployment.contractAddress, contractJson.abi, wallet);
  const iface = new ethers.Interface(contractJson.abi);
  
  console.log(`📍 Contract: ${deployment.contractAddress}`);
  console.log(`👛 Admin Wallet: ${wallet.address}\n`);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Wallet Balance: ${ethers.formatEther(balance)} MON\n`);
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 1: Read Pool Balances
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 1: Read Pool Balances ═══');
  try {
    const [nullPool, leviathanPool, tournamentPool, opsPool] = await contract.getPoolBalances();
    console.log(`  🌀 Null Pool:       ${ethers.formatEther(nullPool)} MON`);
    console.log(`  🐉 Leviathan Pool:  ${ethers.formatEther(leviathanPool)} MON`);
    console.log(`  ⚔️  Tournament Pool: ${ethers.formatEther(tournamentPool)} MON`);
    console.log(`  🔧 Operations Pool: ${ethers.formatEther(opsPool)} MON`);
    console.log('  ✅ PASSED\n');
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 2: Read Season Info
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 2: Read Season Info ═══');
  try {
    const seasonInfo = await contract.getSeasonInfo();
    const entryFee = await contract.getCurrentEntryFee();
    const poolUnlock = await contract.getCurrentPoolUnlock();
    const seasonDay = await contract.getSeasonDay();
    console.log(`  📅 Season: ${seasonInfo[0]}`);
    console.log(`  🗓️ Season Day: ${seasonDay}`);
    console.log(`  💵 Current Entry Fee: ${ethers.formatEther(entryFee)} MON`);
    console.log(`  🔓 Pool Unlock: ${Number(poolUnlock) / 100}%`);
    console.log('  ✅ PASSED\n');
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 3: Read Pool Splits
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 3: Read Pool Splits ═══');
  try {
    const nullSplit = await contract.nullSplit();
    const levSplit = await contract.leviathanSplit();
    const tourneySplit = await contract.tournamentSplit();
    const opsSplit = await contract.operationsSplit();
    console.log(`  🌀 Null:       ${Number(nullSplit) / 100}%`);
    console.log(`  🐉 Leviathan:  ${Number(levSplit) / 100}%`);
    console.log(`  ⚔️  Tournament: ${Number(tourneySplit) / 100}%`);
    console.log(`  🔧 Operations: ${Number(opsSplit) / 100}%`);
    console.log(`  📊 Total: ${(Number(nullSplit) + Number(levSplit) + Number(tourneySplit) + Number(opsSplit)) / 100}%`);
    console.log('  ✅ PASSED\n');
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 4: Check Contract Balance
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 4: Contract Total Balance ═══');
  try {
    const contractBal = await provider.getBalance(deployment.contractAddress);
    console.log(`  💎 Contract Balance: ${ethers.formatEther(contractBal)} MON`);
    console.log('  ✅ PASSED\n');
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 5: Check Owner/Admin Status
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 5: Admin Permissions ═══');
  try {
    const owner = await contract.owner();
    const backend = await contract.backend();
    const isAdmin = owner.toLowerCase() === wallet.address.toLowerCase();
    const isBackend = backend.toLowerCase() === wallet.address.toLowerCase();
    console.log(`  👑 Owner: ${owner}`);
    console.log(`  🔧 Backend: ${backend}`);
    console.log(`  🔐 Current wallet is owner: ${isAdmin ? 'YES ✅' : 'NO ❌'}`);
    console.log(`  🔐 Current wallet is backend: ${isBackend ? 'YES ✅' : 'NO ❌'}`);
    console.log('  ✅ PASSED\n');
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 6: Get Stats
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 6: Contract Stats ═══');
  try {
    const stats = await contract.getStats();
    console.log(`  👥 Total Agents: ${stats[0]}`);
    console.log(`  💵 Total Collected: ${ethers.formatEther(stats[1])} MON`);
    console.log(`  💸 Total Distributed: ${ethers.formatEther(stats[2])} MON`);
    console.log(`  🐉 Leviathan Spawns: ${stats[3]}`);
    console.log(`  ⚔️  Tournaments: ${stats[4]}`);
    console.log('  ✅ PASSED\n');
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 7: Test Entry (if balance allows)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 7: Test Entry Payment ═══');
  const entryFee = await contract.getCurrentEntryFee();
  console.log(`  Entry Fee: ${ethers.formatEther(entryFee)} MON`);
  
  if (balance > entryFee + ethers.parseEther('0.01')) {
    try {
      console.log(`  Sending entry fee...`);
      
      const calldata = iface.encodeFunctionData('enter', []);
      const feeData = await provider.getFeeData();
      const nonce = await provider.getTransactionCount(wallet.address);
      
      const tx = {
        to: deployment.contractAddress,
        value: entryFee,
        data: calldata,
        gasLimit: 150000n,
        gasPrice: feeData.gasPrice,
        nonce: nonce,
        chainId: 10143,
      };
      
      const signedTx = await wallet.signTransaction(tx);
      const txResponse = await provider.broadcastTransaction(signedTx);
      console.log(`  Tx: ${txResponse.hash}`);
      
      const receipt = await txResponse.wait();
      if (receipt?.status === 1) {
        console.log(`  ✅ Entry successful! Gas: ${receipt.gasUsed}`);
        
        // Check pools after
        const [nullPool, leviathanPool, tournamentPool, opsPool] = await contract.getPoolBalances();
        console.log(`  📊 Pools after entry:`);
        console.log(`     Null: ${ethers.formatEther(nullPool)} | Lev: ${ethers.formatEther(leviathanPool)} | Tourn: ${ethers.formatEther(tournamentPool)} | Ops: ${ethers.formatEther(opsPool)}`);
      } else {
        console.log(`  ❌ Entry failed!`);
      }
      console.log('');
    } catch (err: any) {
      console.log(`  ❌ FAILED: ${err.message}\n`);
    }
  } else {
    console.log(`  ⚠️ SKIPPED: Insufficient balance for entry test\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TEST 8: Test Operations Withdrawal
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══ TEST 8: Operations Withdrawal ═══');
  try {
    const [, , , opsBefore] = await contract.getPoolBalances();
    console.log(`  Ops Pool Before: ${ethers.formatEther(opsBefore)} MON`);
    
    if (opsBefore === 0n) {
      console.log('  ⚠️ SKIPPED: No funds in ops pool\n');
    } else {
      console.log(`  Withdrawing all ops funds to wallet...`);
      
      const calldata = iface.encodeFunctionData('withdrawOperations', [wallet.address, 0n]);
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
      console.log(`  Tx: ${txResponse.hash}`);
      
      const receipt = await txResponse.wait();
      if (receipt?.status === 1) {
        const [, , , opsAfter] = await contract.getPoolBalances();
        console.log(`  ✅ Withdrawal successful!`);
        console.log(`  Ops Pool After: ${ethers.formatEther(opsAfter)} MON`);
      } else {
        console.log(`  ❌ Withdrawal failed!`);
      }
      console.log('');
    }
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════');
  console.log('🏁 Testing Complete!');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
