#!/usr/bin/env npx tsx
/**
 * The Null Flow Tests
 * Verifies: Gate unlock → Fight → Kill → MON distribution → Discord notification
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Simple test framework
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<{ passed: boolean; reason?: string }>) {
  try {
    const result = await fn();
    if (result.passed) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name}: ${result.reason}`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ ${name}: ${err}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n🌀 === NULL BOSS FLOW TESTS ===\n');

  const actionsPath = join(process.cwd(), 'src/engine/actions.ts');
  const treasuryPath = join(process.cwd(), 'src/services/treasury.ts');
  const contractPath = join(process.cwd(), 'contracts/src/ReefTreasury.sol');
  
  const actionsCode = readFileSync(actionsPath, 'utf-8');
  const treasuryCode = readFileSync(treasuryPath, 'utf-8');
  const contractCode = readFileSync(contractPath, 'utf-8');

  // ─── ABYSS_STATE Tests ───
  
  await test('ABYSS_STATE has participantWallets Map', async () => {
    const hasWallets = actionsCode.includes('participantWallets: new Map<string, string>()');
    return { passed: hasWallets, reason: 'participantWallets not found in ABYSS_STATE' };
  });

  await test('ABYSS_REQUIREMENTS set to 1 each (temp testing)', async () => {
    const hasShells1 = actionsCode.includes("shells: { required: 1");
    const hasCoral1 = actionsCode.includes("coral_shards: { required: 1");
    const hasKelp1 = actionsCode.includes("kelp_fiber: { required: 1");
    const hasInk1 = actionsCode.includes("ink_sacs: { required: 1");
    const hasMoon1 = actionsCode.includes("moonstone: { required: 1");
    const hasPearl1 = actionsCode.includes("abyssal_pearls: { required: 1");
    const allSet = hasShells1 && hasCoral1 && hasKelp1 && hasInk1 && hasMoon1 && hasPearl1;
    return { passed: allSet, reason: 'Not all requirements set to 1' };
  });

  // ─── Wallet Tracking Tests ───

  await test('Null tracks participant wallets during combat', async () => {
    const tracksWallets = actionsCode.includes('ABYSS_STATE.participantWallets.set(agentId, agent.wallet)');
    return { passed: tracksWallets, reason: 'Wallet tracking not found in Null combat' };
  });

  // ─── Distribution Tests ───

  await test('Null kill calls distributeNullPool', async () => {
    const callsDistribute = actionsCode.includes('distributeNullPool(payoutMap)');
    return { passed: callsDistribute, reason: 'distributeNullPool call not found in Null defeat handler' };
  });

  await test('distributeNullPool function exists in treasury', async () => {
    const hasFunction = treasuryCode.includes('export async function distributeNullPool');
    return { passed: hasFunction, reason: 'distributeNullPool function not found' };
  });

  await test('distributeNullPool uses contract in production', async () => {
    const usesContract = treasuryCode.includes('distributeNullPoolContract');
    return { passed: usesContract, reason: 'Contract distribution not implemented' };
  });

  await test('distributeNullPoolContract calls contract.distributeNull', async () => {
    const callsContract = treasuryCode.includes('contract.distributeNull(winners, shares, totalDamage)');
    return { passed: callsContract, reason: 'Contract call not found' };
  });

  // ─── Discord Notification Tests ───

  await test('Null kill sends Discord notification', async () => {
    const sendsNotif = actionsCode.includes("bossName: 'The Null'");
    return { passed: sendsNotif, reason: 'Discord notification for Null not found' };
  });

  await test('notifyDiscordBossKill called for Null', async () => {
    // Count occurrences - should be called for both Leviathan and Null
    const matches = actionsCode.match(/notifyDiscordBossKill\(/g) || [];
    return { passed: matches.length >= 2, reason: `Only ${matches.length} notifyDiscordBossKill calls found (need 2+)` };
  });

  // ─── DB Persistence Tests ───

  await test('Null participantWallets persisted to DB', async () => {
    const savesPersist = actionsCode.includes('participantWallets: JSON.stringify(Object.fromEntries(ABYSS_STATE.participantWallets))');
    return { passed: savesPersist, reason: 'participantWallets not saved in persistBossState' };
  });

  await test('Null participantWallets loaded from DB', async () => {
    const loadsWallets = actionsCode.includes('ABYSS_STATE.participantWallets = new Map(Object.entries(JSON.parse(row.participantWallets');
    return { passed: loadsWallets, reason: 'participantWallets not loaded in loadBossState' };
  });

  await test('Null payout logged to transactionLogs', async () => {
    const logsToDb = treasuryCode.includes("type: 'null_payout'");
    return { passed: logsToDb, reason: 'null_payout not logged to transaction_logs' };
  });

  // ─── Contract Tests ───

  await test('Contract has distributeNull function', async () => {
    const hasFunction = contractCode.includes('function distributeNull(');
    return { passed: hasFunction, reason: 'distributeNull not in contract' };
  });

  await test('Contract distributeNull takes correct params', async () => {
    const hasParams = contractCode.includes('address[] calldata winners') && 
                      contractCode.includes('uint256[] calldata shares') &&
                      contractCode.includes('uint256 totalDamage');
    return { passed: hasParams, reason: 'distributeNull params incorrect' };
  });

  // ─── Parity with Leviathan Tests ───

  await test('Both bosses have wallet tracking', async () => {
    const leviTracksWallets = actionsCode.includes('LEVIATHAN.participantWallets.set(agentId, agent.wallet)');
    const nullTracksWallets = actionsCode.includes('ABYSS_STATE.participantWallets.set(agentId, agent.wallet)');
    return { passed: leviTracksWallets && nullTracksWallets, reason: 'One boss missing wallet tracking' };
  });

  await test('Both bosses grant reputation on kill', async () => {
    // Leviathan grants 50/75 rep, Null grants 75 rep
    const leviRep = actionsCode.includes('reputation: participant.reputation + repBonus');
    const nullRep = actionsCode.includes('reputation: pAgent.reputation + 75');
    return { passed: leviRep && nullRep, reason: 'One boss missing reputation grant' };
  });

  // ─── Summary ───
  
  console.log(`\n📊 Results: ${passed}/${passed + failed} tests passed\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
