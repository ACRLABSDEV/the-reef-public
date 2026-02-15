#!/usr/bin/env npx tsx
/**
 * Full Leviathan Distribution Integration Test
 * 
 * Simulates the EXACT flow that happens in production:
 * 1. Create agents with wallets
 * 2. Agents attack Leviathan (adding to participants/participantWallets)
 * 3. Kill Leviathan
 * 4. Verify distribution logic produces correct payoutMap
 * 5. Verify contract call would be valid
 */

import { ethers } from 'ethers';

// ─── Simulated LEVIATHAN state (exactly as in actions.ts) ───
const LEVIATHAN = {
  currentHp: 250,
  maxHp: 250,
  isAlive: true,
  participants: new Map<string, number>(),        // agentId -> damage
  participantWallets: new Map<string, string>(),  // agentId -> wallet
  rewards: [
    { resource: 'moonstone', amount: 3 },
    { resource: 'abyssal_pearls', amount: 5 },
  ],
};

// ─── Simulated agents (exactly as in state.ts) ───
const AGENTS = new Map<string, { id: string; name: string; wallet: string; hp: number }>();

function createTestAgent(name: string, wallet: string): string {
  const id = `agent-${name.toLowerCase()}`;
  AGENTS.set(id, { id, name, wallet, hp: 100 });
  console.log(`✅ Created agent: ${name} (wallet: ${wallet.slice(0,10)}...)`);
  return id;
}

function getAgent(id: string) {
  return AGENTS.get(id);
}

// ─── Simulated attack (exactly as in handleBoss in actions.ts) ───
function attackLeviathan(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent) {
    console.log(`❌ Agent ${agentId} not found`);
    return;
  }
  
  const previousDamage = LEVIATHAN.participants.get(agentId) || 0;
  const maxDamagePerAgent = 50; // From LEVIATHAN config
  
  if (previousDamage >= maxDamagePerAgent) {
    console.log(`⚠️ ${agent.name} has already dealt max damage (${maxDamagePerAgent})`);
    return;
  }
  
  const damage = 15 + Math.floor(Math.random() * 20);
  const actualDamage = Math.min(damage, maxDamagePerAgent - previousDamage, LEVIATHAN.currentHp);
  
  LEVIATHAN.currentHp = Math.max(0, LEVIATHAN.currentHp - actualDamage);
  LEVIATHAN.participants.set(agentId, previousDamage + actualDamage);
  
  // THIS IS THE CRITICAL LINE - track wallet for payout
  if (agent.wallet) {
    LEVIATHAN.participantWallets.set(agentId, agent.wallet);
    console.log(`   [Leviathan] Tracked wallet for ${agent.name}: ${agent.wallet.slice(0,10)}...`);
  } else {
    console.error(`   ❌ [Leviathan] NO WALLET for agent ${agent.name}`);
  }
  
  console.log(`⚔️ ${agent.name} dealt ${actualDamage} damage (total: ${previousDamage + actualDamage})`);
  console.log(`   Leviathan HP: ${LEVIATHAN.currentHp}/${LEVIATHAN.maxHp}`);
  
  if (LEVIATHAN.currentHp <= 0) {
    console.log(`\n🎉 LEVIATHAN IS DEAD!\n`);
    LEVIATHAN.isAlive = false;
  }
}

// ─── Simulated distribution (exactly as in handleBoss in actions.ts) ───
function distributeRewards() {
  const leviathanPoolMon = 0.15; // Mock pool balance
  
  console.log('═══════════════════════════════════════');
  console.log('💰 DISTRIBUTING LEVIATHAN REWARDS');
  console.log('═══════════════════════════════════════\n');
  
  const participants = Array.from(LEVIATHAN.participants.entries());
  const totalDamage = participants.reduce((sum, [, dmg]) => sum + dmg, 0);
  
  console.log(`Participants: ${participants.length}`);
  console.log(`Total Damage: ${totalDamage}`);
  console.log(`Pool: ${leviathanPoolMon} MON`);
  console.log(`participantWallets size: ${LEVIATHAN.participantWallets.size}`);
  console.log();
  
  // Split: 60% equal, 40% damage-based
  const equalPool = leviathanPoolMon * 0.6;
  const damagePool = leviathanPoolMon * 0.4;
  const equalShare = equalPool / participants.length;
  
  // Build payoutMap (EXACTLY as in actions.ts lines 2509-2513)
  const payoutMap = new Map<string, { address: string; damageShare: number }>();
  
  for (const [participantId, dmg] of participants) {
    const damageShare = dmg / totalDamage;
    const totalShare = (1 / participants.length) * 0.6 + damageShare * 0.4;
    const monShare = equalShare + (damagePool * damageShare);
    
    // THIS IS THE CRITICAL LINE - get wallet from participantWallets
    const walletAddr = LEVIATHAN.participantWallets.get(participantId);
    
    console.log(`${getAgent(participantId)?.name}:`);
    console.log(`  Damage: ${dmg} (${(damageShare * 100).toFixed(1)}%)`);
    console.log(`  MON Share: ${monShare.toFixed(6)}`);
    console.log(`  Wallet: ${walletAddr || '❌ MISSING'}`);
    
    if (walletAddr) {
      payoutMap.set(participantId, { address: walletAddr, damageShare: totalShare });
    } else {
      console.log(`  ⚠️ NO WALLET - would be excluded from payout!`);
    }
    console.log();
  }
  
  // Verify payoutMap
  console.log('═══════════════════════════════════════');
  console.log('📋 PAYOUT MAP VERIFICATION');
  console.log('═══════════════════════════════════════\n');
  
  console.log(`payoutMap size: ${payoutMap.size} / ${participants.length} participants`);
  
  if (payoutMap.size === 0) {
    console.log('\n❌ CRITICAL FAILURE: payoutMap is EMPTY!');
    console.log('   No agents would receive MON rewards.');
    return false;
  }
  
  if (payoutMap.size < participants.length) {
    console.log(`\n⚠️ WARNING: ${participants.length - payoutMap.size} participants missing from payoutMap`);
  }
  
  // Format for contract call
  const winners: string[] = [];
  const shares: bigint[] = [];
  
  for (const [, data] of payoutMap) {
    try {
      winners.push(ethers.getAddress(data.address));
      shares.push(BigInt(Math.floor(data.damageShare * 10000)));
    } catch {
      console.log(`⚠️ Invalid address: ${data.address}`);
    }
  }
  
  console.log('\n🔗 Contract Call Formation:');
  console.log(`   Winners: [${winners.length} addresses]`);
  console.log(`   Shares: [${shares.join(', ')}] (total: ${shares.reduce((a,b) => a+b, 0n)})`);
  
  if (winners.length > 0 && shares.reduce((a,b) => a+b, 0n) === 10000n) {
    console.log('\n✅ SUCCESS: Distribution would work correctly!');
    return true;
  } else {
    console.log(`\n❌ FAILURE: Invalid distribution (shares sum to ${shares.reduce((a,b) => a+b, 0n)}, expected 10000)`);
    return false;
  }
}

// ─── Test Persistence Simulation ───
function simulatePersistence() {
  console.log('\n═══════════════════════════════════════');
  console.log('💾 SIMULATING PERSISTENCE/RELOAD');
  console.log('═══════════════════════════════════════\n');
  
  // Simulate what persistBossState() does
  const serialized = {
    participants: JSON.stringify(Object.fromEntries(LEVIATHAN.participants)),
    participantWallets: JSON.stringify(Object.fromEntries(LEVIATHAN.participantWallets)),
  };
  
  console.log('Serialized state:');
  console.log(`  participants: ${serialized.participants}`);
  console.log(`  participantWallets: ${serialized.participantWallets}`);
  
  // Clear (simulating restart)
  LEVIATHAN.participants.clear();
  LEVIATHAN.participantWallets.clear();
  console.log('\n📤 Cleared in-memory state (simulating restart)');
  
  // Simulate what loadBossState() does
  LEVIATHAN.participants = new Map(
    Object.entries(JSON.parse(serialized.participants)).map(([k, v]) => [k, Number(v)])
  );
  LEVIATHAN.participantWallets = new Map(Object.entries(JSON.parse(serialized.participantWallets)));
  
  console.log('📥 Reloaded state:');
  console.log(`  participants: ${LEVIATHAN.participants.size} entries`);
  console.log(`  participantWallets: ${LEVIATHAN.participantWallets.size} entries`);
  
  // Verify wallets survived
  for (const [id, wallet] of LEVIATHAN.participantWallets) {
    console.log(`    ${id} -> ${wallet.slice(0,10)}...`);
  }
  
  if (LEVIATHAN.participantWallets.size > 0) {
    console.log('\n✅ Wallets survived persistence cycle!');
    return true;
  } else {
    console.log('\n❌ FAILURE: Wallets lost during persistence!');
    return false;
  }
}

// ─── Run Full Test ───
console.log('╔═══════════════════════════════════════════════════╗');
console.log('║  LEVIATHAN DISTRIBUTION INTEGRATION TEST         ║');
console.log('╚═══════════════════════════════════════════════════╝\n');

// Step 1: Create test agents with real-ish wallet addresses
console.log('📝 Step 1: Creating test agents\n');
const alpha = createTestAgent('SquadAlpha', '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
const bravo = createTestAgent('SquadBravo', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
const delta = createTestAgent('SquadDelta', '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');

// Step 2: Agents attack Leviathan
console.log('\n📝 Step 2: Agents attacking Leviathan\n');
LEVIATHAN.currentHp = 100; // Lower HP for faster test

attackLeviathan(alpha);
attackLeviathan(bravo);
attackLeviathan(delta);
attackLeviathan(alpha);
attackLeviathan(bravo);
attackLeviathan(delta);
attackLeviathan(alpha);
attackLeviathan(bravo);
attackLeviathan(delta);

// Force kill if not dead
if (LEVIATHAN.currentHp > 0) {
  console.log(`\n⚡ Forcing kill (${LEVIATHAN.currentHp} HP remaining)`);
  LEVIATHAN.currentHp = 0;
  LEVIATHAN.isAlive = false;
  console.log('🎉 LEVIATHAN IS DEAD!\n');
}

// Step 3: Test persistence
const persistOk = simulatePersistence();

// Step 4: Distribute rewards
console.log('\n📝 Step 4: Distributing rewards\n');
const distOk = distributeRewards();

// Summary
console.log('\n═══════════════════════════════════════');
console.log('📊 TEST SUMMARY');
console.log('═══════════════════════════════════════');
console.log(`Persistence: ${persistOk ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Distribution: ${distOk ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Overall: ${persistOk && distOk ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
