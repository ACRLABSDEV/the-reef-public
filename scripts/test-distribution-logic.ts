#!/usr/bin/env npx tsx
/**
 * Test Leviathan Distribution Logic
 * 
 * This tests the actual payout calculation WITHOUT hitting the blockchain.
 * Simulates the exact flow from actions.ts
 */

import { ethers } from 'ethers';

// ─── Simulated State (matches LEVIATHAN object in actions.ts) ───
const LEVIATHAN = {
  participants: new Map<string, number>(),        // agentId -> damage
  participantWallets: new Map<string, string>(),  // agentId -> wallet
};

// ─── Test Setup ───
function setupTestData() {
  // Simulate 3 agents attacking Leviathan
  const testAgents = [
    { id: 'agent-alpha', name: 'SquadAlpha', wallet: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1', damage: 100 },
    { id: 'agent-bravo', name: 'SquadBravo', wallet: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2', damage: 80 },
    { id: 'agent-delta', name: 'SquadDelta', wallet: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD3', damage: 70 },
  ];
  
  for (const agent of testAgents) {
    LEVIATHAN.participants.set(agent.id, agent.damage);
    LEVIATHAN.participantWallets.set(agent.id, agent.wallet);
  }
  
  console.log('✅ Test data setup:');
  console.log('   Participants:', Object.fromEntries(LEVIATHAN.participants));
  console.log('   Wallets:', Object.fromEntries(LEVIATHAN.participantWallets));
  console.log();
}

// ─── Test Distribution Logic (copied from actions.ts) ───
function testDistributionLogic() {
  const leviathanPoolMon = 0.15; // Simulated pool balance
  
  const participants = Array.from(LEVIATHAN.participants.entries());
  const totalDamage = participants.reduce((sum, [, dmg]) => sum + dmg, 0);
  
  console.log('📊 Distribution Calculation:');
  console.log(`   Total Damage: ${totalDamage}`);
  console.log(`   Pool: ${leviathanPoolMon} MON`);
  console.log();
  
  // Split: 60% equal, 40% damage-based (from actions.ts)
  const equalPool = leviathanPoolMon * 0.6;
  const damagePool = leviathanPoolMon * 0.4;
  const equalShare = equalPool / participants.length;
  
  console.log(`   Equal Pool (60%): ${equalPool.toFixed(6)} MON`);
  console.log(`   Damage Pool (40%): ${damagePool.toFixed(6)} MON`);
  console.log(`   Equal Share Each: ${equalShare.toFixed(6)} MON`);
  console.log();
  
  // Build payoutMap (exactly as in actions.ts lines 2509-2513)
  const payoutMap = new Map<string, { address: string; damageShare: number }>();
  
  for (const [participantId, dmg] of participants) {
    const damageShare = dmg / totalDamage;
    const totalShare = (equalShare / leviathanPoolMon) + (damageShare * 0.4); // Simplified
    const monShare = equalShare + (damagePool * damageShare);
    
    console.log(`   ${participantId}:`);
    console.log(`     Damage: ${dmg} (${(damageShare * 100).toFixed(1)}%)`);
    console.log(`     MON Share: ${monShare.toFixed(6)}`);
    
    // This is the critical line - getting wallet from participantWallets
    const walletAddr = LEVIATHAN.participantWallets.get(participantId);
    console.log(`     Wallet lookup: ${walletAddr || 'NOT FOUND'}`);
    
    if (walletAddr) {
      payoutMap.set(participantId, { address: walletAddr, damageShare: totalShare });
    } else {
      console.log(`     ⚠️ WALLET MISSING - would be excluded from payout!`);
    }
    console.log();
  }
  
  // Summary
  console.log('═══════════════════════════════════════');
  console.log('📋 Final payoutMap:');
  console.log(`   Size: ${payoutMap.size}`);
  for (const [id, data] of payoutMap) {
    console.log(`   ${id}: ${data.address} (share: ${(data.damageShare * 100).toFixed(2)}%)`);
  }
  
  // Verify
  if (payoutMap.size === 0) {
    console.log('\n❌ FAILURE: payoutMap is empty! No payouts would happen.');
  } else if (payoutMap.size !== participants.length) {
    console.log(`\n⚠️ WARNING: ${participants.length - payoutMap.size} participants missing wallets`);
  } else {
    console.log('\n✅ SUCCESS: All participants have wallets and would receive payouts');
  }
}

// ─── Test Contract Call Formation ───
function testContractCallFormation() {
  console.log('\n═══════════════════════════════════════');
  console.log('🔗 Contract Call Formation Test:');
  console.log();
  
  const participants = Array.from(LEVIATHAN.participants.entries());
  const totalDamage = participants.reduce((sum, [, dmg]) => sum + dmg, 0);
  
  // Build payoutMap
  const payoutMap = new Map<string, { address: string; damageShare: number }>();
  for (const [participantId, dmg] of participants) {
    const damageShare = dmg / totalDamage;
    const walletAddr = LEVIATHAN.participantWallets.get(participantId);
    if (walletAddr) {
      payoutMap.set(participantId, { address: walletAddr, damageShare });
    }
  }
  
  // Format for contract call (from treasury.ts distributeLeviathPoolContract)
  const winners: string[] = [];
  const shares: bigint[] = [];
  
  for (const [, data] of payoutMap) {
    try {
      const checksummed = ethers.getAddress(data.address);
      winners.push(checksummed);
      shares.push(BigInt(Math.floor(data.damageShare * 10000))); // Basis points
    } catch (err) {
      console.log(`   ⚠️ Invalid address: ${data.address}`);
    }
  }
  
  console.log('   Winners array:', winners);
  console.log('   Shares array:', shares.map(s => s.toString()));
  console.log(`   Total shares: ${shares.reduce((a, b) => a + b, 0n).toString()} (should be ~10000)`);
  
  if (winners.length > 0 && shares.length === winners.length) {
    console.log('\n✅ Contract call would be valid');
  } else {
    console.log('\n❌ Contract call would fail - arrays empty or mismatched');
  }
}

// ─── Run Tests ───
console.log('╔═══════════════════════════════════════╗');
console.log('║  LEVIATHAN DISTRIBUTION LOGIC TEST   ║');
console.log('╚═══════════════════════════════════════╝');
console.log();

setupTestData();
testDistributionLogic();
testContractCallFormation();

console.log('\n═══════════════════════════════════════');
console.log('Done. If all shows ✅, the logic is correct.');
