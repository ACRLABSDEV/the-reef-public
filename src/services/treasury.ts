/**
 * Treasury Service - MON Payment & Distribution
 * 
 * Architecture:
 * - PRIMARY: Smart contract holds funds, handles splits & payouts
 * - FALLBACK: Custodial wallet (DEV_MODE only, for testing)
 * 
 * Smart Contract Flow:
 * 1. Agent calls contract.enter{value: fee}() 
 * 2. Contract auto-splits: 40% Null, 30% Leviathan, 20% Tournament, 10% Ops
 * 3. Backend calls contract.distributeLeviathan(winners[], shares[]) on kill
 * 4. Contract pushes payouts (or winners claim)
 * 
 * Backend only needs admin signer for: pause, upgrade, emergency withdraw
 * Backend does NOT hold player funds.
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const REEF_CONTRACT_ABI = require('../abi/ReefTreasury.json');

// ─── Configuration ───
const MONAD_RPC = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const DEV_MODE = process.env.DEV_MODE === 'true';

// Smart contract (production)
const REEF_CONTRACT_ADDRESS = process.env.REEF_CONTRACT_ADDRESS;
const REEF_CONTRACT_VERSION = process.env.REEF_CONTRACT_VERSION || 'v1';

// Backend signer - for calling distribution functions on contract
// NOT the owner/admin - this wallet can only trigger payouts, not admin functions
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;

// Custodial fallback (DEV_MODE only) - DEPRECATED, use contract in production
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;

// Fee configuration - single fixed fee, not a range
const ENTRY_FEE_MON = parseFloat(process.env.ENTRY_FEE || '50');

// Discord webhook for boss kill notifications
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Pool allocation percentages
const POOL_ALLOCATION = {
  null: 0.40,        // 40% to The Null (season finale boss)
  leviathan: 0.30,   // 30% to Leviathan kill rewards
  tournament: 0.20,  // 20% to Tournament winners
  operations: 0.10,  // 10% to Operations/Team
} as const;

// ─── State ───
interface TreasuryState {
  nullPool: bigint;         // In wei - The Null (finale boss)
  leviathanPool: bigint;    // In wei
  tournamentPool: bigint;   // In wei
  operationsPool: bigint;   // In wei
  totalCollected: bigint;   // Total MON ever collected
  totalPaidOut: bigint;     // Total MON ever paid out
}

const treasuryState: TreasuryState = {
  nullPool: 0n,
  leviathanPool: 0n,
  tournamentPool: 0n,
  operationsPool: 0n,
  totalCollected: 0n,
  totalPaidOut: 0n,
};

// ─── Provider & Wallets ───
let provider: ethers.JsonRpcProvider | null = null;
let backendWallet: ethers.Wallet | null = null;
let custodialWallet: ethers.Wallet | null = null; // DEV_MODE only
let reefContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(MONAD_RPC);
  }
  return provider;
}

// Backend wallet - for calling contract admin functions only
function getBackendWallet(): ethers.Wallet | null {
  if (!backendWallet && BACKEND_PRIVATE_KEY) {
    try {
      backendWallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, getProvider());
      console.log(`[Treasury] Backend wallet initialized: ${backendWallet.address}`);
    } catch (err) {
      console.error('[Treasury] Failed to initialize admin wallet:', err);
      return null;
    }
  }
  return backendWallet;
}

// Custodial wallet - ONLY for DEV_MODE testing, not production
function getCustodialWallet(): ethers.Wallet | null {
  if (!DEV_MODE) {
    console.warn('[Treasury] Custodial wallet only available in DEV_MODE');
    return null;
  }
  if (!custodialWallet && TREASURY_PRIVATE_KEY) {
    try {
      custodialWallet = new ethers.Wallet(TREASURY_PRIVATE_KEY, getProvider());
      console.log(`[Treasury] Custodial wallet initialized (DEV_MODE): ${custodialWallet.address}`);
    } catch (err) {
      console.error('[Treasury] Failed to initialize custodial wallet:', err);
      return null;
    }
  }
  return custodialWallet;
}

// Backwards compat
function getTreasuryWallet(): ethers.Wallet | null {
  return getCustodialWallet();
}

// ─── Contract Interface ───
// ABI is imported from Foundry-generated artifact at ../abi/ReefTreasury.json

function getReefContract(): ethers.Contract | null {
  if (!REEF_CONTRACT_ADDRESS) {
    return null;
  }
  if (!reefContract) {
    const signer = getBackendWallet();
    reefContract = new ethers.Contract(
      REEF_CONTRACT_ADDRESS,
      REEF_CONTRACT_ABI,
      signer || getProvider() // Read-only if no admin key
    );
    console.log(`[Treasury] Contract initialized: ${REEF_CONTRACT_ADDRESS}`);
  }
  return reefContract;
}

// ─── Validation Helpers ───
function isValidAddress(address: string): boolean {
  try {
    ethers.getAddress(address); // Throws if invalid
    return true;
  } catch {
    return false;
  }
}

function checksumAddress(address: string): string {
  return ethers.getAddress(address);
}

function parseMonAmount(amount: number): bigint {
  if (amount <= 0) throw new Error('Amount must be positive');
  return ethers.parseEther(amount.toString());
}

function formatMonAmount(wei: bigint): number {
  return parseFloat(ethers.formatEther(wei));
}

// ─── Discord Notifications ───
export interface BossKillNotification {
  bossName: string;
  participants: Array<{
    name: string;
    wallet: string;
    damage: number;
    damagePercent: number;
    monEarned: number;
  }>;
  totalMon: number;
  txHash?: string;
  legendaryWinner?: string;
  legendaryItem?: string;
}

export async function notifyDiscordBossKill(data: BossKillNotification): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('[Discord] No webhook URL configured, skipping notification');
    return;
  }

  try {
    const participantList = data.participants
      .sort((a, b) => b.damage - a.damage)
      .map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
        const walletShort = `${p.wallet.slice(0, 6)}...${p.wallet.slice(-4)}`;
        return `${medal} **${p.name}** — ${p.damage} dmg (${p.damagePercent.toFixed(1)}%) → **${p.monEarned.toFixed(4)} MON** \`${walletShort}\``;
      })
      .join('\n');

    let description = `**${data.bossName}** has been slain!\n\n`;
    description += `💰 **Total Pool:** ${data.totalMon.toFixed(4)} MON\n\n`;
    description += `**Damage & Rewards:**\n${participantList}`;

    if (data.legendaryWinner) {
      description += `\n\n🏆 **LEGENDARY DROP:** ${data.legendaryWinner} received **${data.legendaryItem || 'Leviathan Spine'}**!`;
    }

    if (data.txHash) {
      description += `\n\n📜 [View Transaction](https://testnet.monadexplorer.com/tx/${data.txHash})`;
    }

    const embed = {
      title: `🐉 ${data.bossName} DEFEATED!`,
      description,
      color: 0xffd93d, // Gold
      thumbnail: {
        url: 'https://thereef.co/dashboard/assets/leviathan.gif'
      },
      footer: {
        text: 'The Reef • Monad Testnet'
      },
      timestamp: new Date().toISOString()
    };

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      console.error('[Discord] Webhook failed:', response.status, await response.text());
    } else {
      console.log('[Discord] Boss kill notification sent');
    }
  } catch (err) {
    console.error('[Discord] Failed to send notification:', err);
  }
}

// ─── Entry Fee Collection ───
export interface EntryFeeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  poolsUpdated?: {
    null: number;
    leviathan: number;
    tournament: number;
    operations: number;
  };
}

/**
 * Record entry fee in DEV_MODE (simulates on-chain payment).
 * In production, use verifyAgentEntry() to check on-chain payment.
 */
export function recordEntryFee(agentAddress: string): EntryFeeResult {
  if (!DEV_MODE) {
    return { success: false, error: 'Use smart contract for entry in production' };
  }
  
  try {
    if (!isValidAddress(agentAddress)) {
      return { success: false, error: 'Invalid agent address' };
    }

    const amountWei = parseMonAmount(ENTRY_FEE_MON);
    
    // Split into pools (40% Null, 30% Leviathan, 20% Tournament, 10% Ops)
    const nullShare = (amountWei * BigInt(Math.floor(POOL_ALLOCATION.null * 100))) / 100n;
    const leviathanShare = (amountWei * BigInt(Math.floor(POOL_ALLOCATION.leviathan * 100))) / 100n;
    const tournamentShare = (amountWei * BigInt(Math.floor(POOL_ALLOCATION.tournament * 100))) / 100n;
    const operationsShare = amountWei - nullShare - leviathanShare - tournamentShare;

    // Update state
    treasuryState.nullPool += nullShare;
    treasuryState.leviathanPool += leviathanShare;
    treasuryState.tournamentPool += tournamentShare;
    treasuryState.operationsPool += operationsShare;
    treasuryState.totalCollected += amountWei;

    console.log(`[Treasury] Entry fee recorded (DEV_MODE): ${ENTRY_FEE_MON} MON from ${agentAddress}`);

    return {
      success: true,
      poolsUpdated: {
        null: formatMonAmount(treasuryState.nullPool),
        leviathan: formatMonAmount(treasuryState.leviathanPool),
        tournament: formatMonAmount(treasuryState.tournamentPool),
        operations: formatMonAmount(treasuryState.operationsPool),
      },
    };
  } catch (err) {
    console.error('[Treasury] recordEntryFee error:', err);
    return { success: false, error: String(err) };
  }
}

// ─── Payouts ───
export interface PayoutResult {
  success: boolean;
  txHash?: string;
  amount?: number;
  error?: string;
}

/**
 * Pay out MON to an address from a specific pool.
 * Uses the treasury wallet to send the transaction.
 */
async function executePayoutUnchecked(
  toAddress: string,
  amountWei: bigint,
  pool: 'null' | 'leviathan' | 'tournament' | 'operations'
): Promise<PayoutResult> {
  const wallet = getTreasuryWallet();
  
  if (!wallet) {
    console.warn('[Treasury] No wallet configured - payout simulated');
    return {
      success: true,
      amount: formatMonAmount(amountWei),
      txHash: 'SIMULATED_NO_WALLET',
    };
  }

  try {
    // Check pool has enough
    const poolKey = `${pool}Pool` as keyof TreasuryState;
    const poolBalance = treasuryState[poolKey] as bigint;
    
    if (poolBalance < amountWei) {
      return {
        success: false,
        error: `Insufficient ${pool} pool balance. Has: ${formatMonAmount(poolBalance)}, Needs: ${formatMonAmount(amountWei)}`,
      };
    }

    // Estimate gas
    const gasEstimate = await wallet.estimateGas({
      to: checksumAddress(toAddress),
      value: amountWei,
    });

    // Send transaction with 20% gas buffer
    const tx = await wallet.sendTransaction({
      to: checksumAddress(toAddress),
      value: amountWei,
      gasLimit: (gasEstimate * 120n) / 100n,
    });

    console.log(`[Treasury] Payout sent: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait(1);
    
    if (receipt?.status === 1) {
      // Deduct from pool
      (treasuryState[poolKey] as bigint) = poolBalance - amountWei;
      treasuryState.totalPaidOut += amountWei;
      
      console.log(`[Treasury] Payout confirmed: ${formatMonAmount(amountWei)} MON to ${toAddress}`);
      
      return {
        success: true,
        txHash: tx.hash,
        amount: formatMonAmount(amountWei),
      };
    } else {
      return { success: false, error: 'Transaction failed' };
    }
  } catch (err) {
    console.error('[Treasury] Payout error:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Distribute Leviathan pool to kill participants.
 * Uses smart contract in production, custodial in DEV_MODE.
 * @param participants - Map of agentId -> { address, damageShare (0-1), agentName? }
 * @param totalDamage - Total damage dealt by all participants (for contract call)
 * @param tick - Current game tick (for logging)
 */
export async function distributeLeviathPool(
  participants: Map<string, { address: string; damageShare: number; agentId?: string; agentName?: string }>,
  totalDamage: number = 0,
  tick: number = 0
): Promise<Map<string, PayoutResult>> {
  const results = new Map<string, PayoutResult>();
  
  // Production: Use smart contract
  const contract = getReefContract();
  if (contract && !DEV_MODE) {
    const contractResult = await distributeLeviathPoolContract(participants, totalDamage, tick);
    // Contract does batch distribution - calculate individual shares from total
    const totalDistributed = contractResult.amount || 0;
    for (const [agentId, data] of participants) {
      results.set(agentId, {
        success: contractResult.success,
        txHash: contractResult.txHash,
        amount: totalDistributed * data.damageShare, // Individual share
        error: contractResult.error,
      });
    }
    return results;
  }
  
  // DEV_MODE: Use custodial wallet
  const poolBalance = treasuryState.leviathanPool;

  if (poolBalance === 0n) {
    console.warn('[Treasury] Leviathan pool is empty');
    for (const [agentId] of participants) {
      results.set(agentId, { success: false, error: 'Pool is empty' });
    }
    return results;
  }

  // Validate all addresses first
  for (const [agentId, data] of participants) {
    if (!isValidAddress(data.address)) {
      results.set(agentId, { success: false, error: 'Invalid address' });
    }
  }

  // Calculate and execute payouts
  for (const [agentId, data] of participants) {
    if (results.has(agentId)) continue; // Skip invalid

    const shareWei = (poolBalance * BigInt(Math.floor(data.damageShare * 10000))) / 10000n;
    
    if (shareWei === 0n) {
      results.set(agentId, { success: false, error: 'Share too small' });
      continue;
    }

    const result = await executePayoutUnchecked(data.address, shareWei, 'leviathan');
    results.set(agentId, result);
  }

  return results;
}

/**
 * Distribute Tournament pool to winner.
 * Uses smart contract in production, custodial in DEV_MODE.
 * @param winnerAddress - Winner's wallet address
 * @param tournamentSize - Number of participants (affects tier)
 */
export async function distributeTournamentPrize(
  winnerAddress: string,
  tournamentSize: number
): Promise<PayoutResult> {
  if (!isValidAddress(winnerAddress)) {
    return { success: false, error: 'Invalid winner address' };
  }

  // Calculate tier based on tournament size
  let tier = 0; // Bronze
  if (tournamentSize >= 128) tier = 3;      // Legendary: 100%
  else if (tournamentSize >= 64) tier = 2;  // Gold: 50%
  else if (tournamentSize >= 32) tier = 1;  // Silver: 25%
  // else tier = 0; // Bronze: no MON

  // Production: Use smart contract
  const contract = getReefContract();
  if (contract && !DEV_MODE) {
    if (tier === 0) {
      return { success: true, amount: 0, txHash: 'NO_MON_BRONZE_TIER' };
    }
    return distributeTournamentPrizeContract(winnerAddress, tier);
  }

  // DEV_MODE: Use custodial wallet
  const poolBalance = treasuryState.tournamentPool;
  
  if (poolBalance === 0n) {
    return { success: false, error: 'Tournament pool is empty' };
  }

  // Calculate multiplier from tier
  const multipliers = [0, 0.25, 0.5, 1.0]; // Bronze, Silver, Gold, Legendary
  const multiplier = multipliers[tier];

  if (multiplier === 0) {
    return { success: true, amount: 0, txHash: 'NO_MON_BRONZE_TIER' };
  }

  const prizeWei = (poolBalance * BigInt(Math.floor(multiplier * 100))) / 100n;
  
  return executePayoutUnchecked(winnerAddress, prizeWei, 'tournament');
}

/**
 * Withdraw from operations pool to team wallet.
 */
export async function withdrawOperations(
  teamAddress: string,
  amountMon?: number // If not specified, withdraw all
): Promise<PayoutResult> {
  if (!isValidAddress(teamAddress)) {
    return { success: false, error: 'Invalid team address' };
  }

  // Contract mode
  const contract = getReefContract();
  if (contract && !DEV_MODE) {
    try {
      const amountWei = amountMon 
        ? parseMonAmount(amountMon) 
        : await contract.operationsPool();
      
      const tx = await contract.withdrawOperations(checksumAddress(teamAddress), amountWei);
      const receipt = await tx.wait(1);
      
      return {
        success: receipt?.status === 1,
        txHash: tx.hash,
        amount: formatMonAmount(amountWei),
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // Custodial fallback
  const poolBalance = treasuryState.operationsPool;
  const amountWei = amountMon ? parseMonAmount(amountMon) : poolBalance;

  if (amountWei > poolBalance) {
    return { success: false, error: 'Insufficient operations pool balance' };
  }

  return executePayoutUnchecked(teamAddress, amountWei, 'operations');
}

// ─── Contract-Based Distribution (Production) ───

/**
 * Verify agent has paid entry fee on-chain.
 * Returns true if agent has called contract.enter()
 */
export async function verifyAgentEntry(agentAddress: string): Promise<boolean> {
  if (DEV_MODE) {
    console.log(`[Treasury] DEV_MODE: Skipping entry verification for ${agentAddress}`);
    return true;
  }
  
  const contract = getReefContract();
  if (!contract) {
    console.warn('[Treasury] No contract configured, cannot verify entry');
    return false;
  }
  
  try {
    return await contract.hasEntered(checksumAddress(agentAddress));
  } catch (err) {
    console.error('[Treasury] Entry verification failed:', err);
    return false;
  }
}

/**
 * Distribute Leviathan pool via smart contract.
 * Called by backend when Leviathan is killed.
 * @param participants - Map of agentId -> { address, damageShare (0-1) }
 * @param totalDamage - Total damage dealt by all participants
 */
export async function distributeLeviathPoolContract(
  participants: Map<string, { address: string; damageShare: number; agentId?: string; agentName?: string }>,
  totalDamage: number = 0,
  tick: number = 0
): Promise<PayoutResult> {
  const contract = getReefContract();
  
  if (!contract) {
    return { success: false, error: 'No contract configured' };
  }
  
  const backendWallet = getBackendWallet();
  if (!backendWallet) {
    return { success: false, error: 'No admin wallet configured' };
  }
  
  try {
    // Get pool balance before distribution
    const poolBefore = formatMonAmount(await contract.leviathanPool());
    
    // Get current spawn count to use as spawnId
    const spawnCount = await contract.leviathanSpawnCount();
    const spawnId = Number(spawnCount);
    
    const winners: string[] = [];
    const shares: bigint[] = [];
    const recipientData: Array<{ wallet: string; share: number; agentId?: string; agentName?: string }> = [];
    
    for (const [agentId, data] of participants) {
      if (!isValidAddress(data.address)) continue;
      const addr = checksumAddress(data.address);
      winners.push(addr);
      shares.push(BigInt(Math.floor(data.damageShare * 10000))); // Basis points
      recipientData.push({
        wallet: addr,
        share: data.damageShare,
        agentId,
        agentName: data.agentName,
      });
    }
    
    if (winners.length === 0) {
      return { success: false, error: 'No valid participants' };
    }
    
    console.log(`[Treasury] Calling distributeLeviathan(${spawnId}, ${winners.length} winners, shares, ${totalDamage})`);
    
    const tx = await contract.distributeLeviathan(spawnId, winners, shares, totalDamage);
    const receipt = await tx.wait(1);
    
    if (receipt?.status === 1) {
      // Get pool balance after distribution
      const poolAfter = formatMonAmount(await contract.leviathanPool());
      const totalDistributed = poolBefore - poolAfter;
      
      // Log transaction to database
      try {
        const { db, schema } = await import('../db/index.js');
        const seasonInfo = await getSeasonInfo();
        
        db.insert(schema.transactionLogs).values({
          txHash: tx.hash,
          type: 'leviathan_payout',
          fromAddress: backendWallet.address,
          recipients: JSON.stringify(recipientData.map(r => ({
            ...r,
            amount: totalDistributed * r.share,
          }))),
          totalAmount: totalDistributed,
          poolBefore,
          poolAfter,
          seasonDay: seasonInfo.day,
          spawnId,
          tick,
          createdAt: new Date().toISOString(),
        }).run();
        
        console.log(`[Treasury] Logged tx ${tx.hash} - distributed ${totalDistributed.toFixed(4)} MON`);
      } catch (logErr) {
        console.error('[Treasury] Failed to log transaction:', logErr);
      }
      
      return {
        success: true,
        txHash: tx.hash,
        amount: totalDistributed,
      };
    }
    
    return { success: false, error: 'Transaction failed' };
  } catch (err) {
    console.error('[Treasury] Contract distribution failed:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Distribute tournament prize via smart contract.
 * @param winnerAddress - Champion's wallet address
 * @param tier - 0=Bronze, 1=Silver, 2=Gold, 3=Legendary
 * @param tournamentId - Optional tournament ID (defaults to current count)
 */
export async function distributeTournamentPrizeContract(
  winnerAddress: string,
  tier: number, // 0=Bronze, 1=Silver, 2=Gold, 3=Legendary
  tournamentId?: number
): Promise<PayoutResult> {
  const contract = getReefContract();
  
  if (!contract) {
    return { success: false, error: 'No contract configured' };
  }
  
  if (!getBackendWallet()) {
    return { success: false, error: 'No admin wallet configured' };
  }
  
  if (!isValidAddress(winnerAddress)) {
    return { success: false, error: 'Invalid winner address' };
  }
  
  try {
    // Get tournament ID from contract if not provided
    const tId = tournamentId ?? Number(await contract.tournamentCount());
    
    console.log(`[Treasury] Calling distributeTournament(${tId}, ${winnerAddress}, ${tier})`);
    
    const tx = await contract.distributeTournament(tId, checksumAddress(winnerAddress), tier);
    const receipt = await tx.wait(1);
    
    return {
      success: receipt?.status === 1,
      txHash: tx.hash,
    };
  } catch (err) {
    console.error('[Treasury] Tournament distribution failed:', err);
    return { success: false, error: String(err) };
  }
}

// ─── Getters ───
export async function getTreasuryStatus() {
  const contract = getReefContract();
  
  // If contract is configured, read pools from chain
  if (contract && !DEV_MODE) {
    try {
      const [nullPool, leviathanPool, tournamentPool, operationsPool, currentEntryFee] = await Promise.all([
        contract.nullPool(),
        contract.leviathanPool(),
        contract.tournamentPool(),
        contract.operationsPool(),
        contract.getCurrentEntryFee(),
      ]);
      
      return {
        mode: 'contract',
        pools: {
          null: formatMonAmount(nullPool),
          leviathan: formatMonAmount(leviathanPool),
          tournament: formatMonAmount(tournamentPool),
          operations: formatMonAmount(operationsPool),
        },
        network: {
          rpcUrl: MONAD_RPC,
          nativeToken: 'MON',
        },
        contract: {
          address: REEF_CONTRACT_ADDRESS,
          version: REEF_CONTRACT_VERSION,
          currentEntryFee: formatMonAmount(currentEntryFee),
        },
        backendConfigured: !!getBackendWallet(),
      };
    } catch (err) {
      console.error('[Treasury] Failed to read contract state:', err);
      // Fall through to in-memory state
    }
  }
  
  // Fallback: in-memory state (DEV_MODE or no contract)
  return {
    mode: DEV_MODE ? 'dev' : 'custodial',
    pools: {
      null: formatMonAmount(treasuryState.nullPool),
      leviathan: formatMonAmount(treasuryState.leviathanPool),
      tournament: formatMonAmount(treasuryState.tournamentPool),
      operations: formatMonAmount(treasuryState.operationsPool),
    },
    totals: {
      collected: formatMonAmount(treasuryState.totalCollected),
      paidOut: formatMonAmount(treasuryState.totalPaidOut),
    },
    network: {
      rpcUrl: MONAD_RPC,
      nativeToken: 'MON',
    },
    contract: REEF_CONTRACT_ADDRESS ? {
      address: REEF_CONTRACT_ADDRESS,
      version: REEF_CONTRACT_VERSION,
    } : null,
    entryFee: ENTRY_FEE_MON,
    custodialWallet: DEV_MODE ? getCustodialWallet()?.address || null : null,
  };
}

export function getNullPool(): number {
  return formatMonAmount(treasuryState.nullPool);
}

export function getLeviathanPool(): number {
  // In production, this returns 0 (in-memory not synced with contract)
  // Use getLeviathanPoolAsync() for accurate on-chain balance
  return formatMonAmount(treasuryState.leviathanPool);
}

export async function getLeviathanPoolAsync(): Promise<number> {
  const contract = getReefContract();
  if (contract && !DEV_MODE) {
    try {
      const poolBalance = await contract.leviathanPool();
      return formatMonAmount(poolBalance);
    } catch (err) {
      console.error('[Treasury] Failed to read Leviathan pool from contract:', err);
    }
  }
  return formatMonAmount(treasuryState.leviathanPool);
}

export function getTournamentPool(): number {
  return formatMonAmount(treasuryState.tournamentPool);
}

export function getOperationsPool(): number {
  return formatMonAmount(treasuryState.operationsPool);
}

/**
 * Distribute Null pool to participants who defeated The Null.
 * Similar to Leviathan but for the season finale boss.
 */
export async function distributeNullPool(
  participants: Map<string, { address: string; damageShare: number; agentId?: string; agentName?: string }>,
  totalDamage: number = 0,
  tick: number = 0
): Promise<Map<string, PayoutResult>> {
  const results = new Map<string, PayoutResult>();
  
  // Production: Use smart contract
  const contract = getReefContract();
  if (contract && !DEV_MODE) {
    const contractResult = await distributeNullPoolContract(participants, totalDamage, tick);
    // Contract does batch distribution - calculate individual shares from total
    const totalDistributed = contractResult.amount || 0;
    for (const [agentId, data] of participants) {
      results.set(agentId, {
        success: contractResult.success,
        txHash: contractResult.txHash,
        amount: totalDistributed * data.damageShare, // Individual share
        error: contractResult.error,
      });
    }
    return results;
  }
  
  // DEV_MODE: Use custodial wallet
  const poolBalance = treasuryState.nullPool;

  if (poolBalance === 0n) {
    console.warn('[Treasury] Null pool is empty');
    for (const [agentId] of participants) {
      results.set(agentId, { success: false, error: 'Pool is empty' });
    }
    return results;
  }

  // Calculate and execute payouts
  for (const [agentId, data] of participants) {
    if (!isValidAddress(data.address)) {
      results.set(agentId, { success: false, error: 'Invalid address' });
      continue;
    }

    const shareWei = (poolBalance * BigInt(Math.floor(data.damageShare * 10000))) / 10000n;
    
    if (shareWei === 0n) {
      results.set(agentId, { success: false, error: 'Share too small' });
      continue;
    }

    const result = await executePayoutUnchecked(data.address, shareWei, 'null');
    results.set(agentId, result);
  }

  // Reset null pool after distribution
  treasuryState.nullPool = 0n;

  return results;
}

/**
 * Distribute Null pool via smart contract.
 * Called by backend when The Null is killed.
 */
async function distributeNullPoolContract(
  participants: Map<string, { address: string; damageShare: number; agentId?: string; agentName?: string }>,
  totalDamage: number = 0,
  tick: number = 0
): Promise<PayoutResult> {
  const contract = getReefContract();
  
  if (!contract) {
    return { success: false, error: 'Contract not available' };
  }
  
  try {
    // Build arrays for contract call
    const winners: string[] = [];
    const shares: bigint[] = [];
    
    for (const [, data] of participants) {
      if (!isValidAddress(data.address)) continue;
      winners.push(data.address);
      // Convert damageShare (0-1) to basis points (0-10000)
      shares.push(BigInt(Math.floor(data.damageShare * 10000)));
    }
    
    if (winners.length === 0) {
      return { success: false, error: 'No valid participants' };
    }
    
    console.log(`[Treasury] Calling distributeNull(${winners.length} winners, shares, ${totalDamage})`);
    
    const tx = await contract.distributeNull(winners, shares, totalDamage);
    const receipt = await tx.wait();
    
    // Get the actual amount distributed from the contract
    const nullPoolBefore = await contract.nullPool();
    
    // Log to DB
    try {
      const { db, schema } = await import('../db/index.js');
      const recipientsData = winners.map((w, i) => ({
        wallet: w,
        share: shares[i].toString(),
      }));
      await db.insert(schema.transactionLogs).values({
        txHash: receipt.hash,
        type: 'null_payout',
        fromAddress: process.env.REEF_CONTRACT_ADDRESS || 'contract',
        recipients: JSON.stringify(recipientsData),
        totalAmount: formatMonAmount(nullPoolBefore),
        poolBefore: formatMonAmount(nullPoolBefore),
        poolAfter: 0,
        tick,
        createdAt: new Date().toISOString(),
      });
    } catch (dbErr) {
      console.error('[Treasury] Failed to log Null payout to DB:', dbErr);
    }
    
    return {
      success: true,
      txHash: receipt.hash,
      amount: formatMonAmount(nullPoolBefore),
    };
  } catch (err) {
    console.error('[Treasury] distributeNull contract call failed:', err);
    return { success: false, error: String(err) };
  }
}

// ─── Season & Dynamic Entry Fee ───

export interface SeasonInfo {
  season: number;
  day: number;           // 1-7
  startTime: number;     // Unix timestamp
  entryFee: number;      // Current fee in MON (decreases through week)
  poolUnlockPercent: number;  // % of pools available for distribution
  daysRemaining: number;
}

/**
 * Get current entry fee from contract (sliding scale based on day of season)
 * Day 1: 100% of base, Day 7: 20% of base
 */
export async function getCurrentEntryFee(): Promise<number> {
  const contract = getReefContract();
  
  if (contract) {
    try {
      const feeWei = await contract.getCurrentEntryFee();
      return formatMonAmount(feeWei);
    } catch (err) {
      console.error('[Treasury] Failed to get current entry fee from contract:', err);
    }
  }
  
  // Fallback: static fee from env
  return ENTRY_FEE_MON;
}

/**
 * Get full season info from contract
 */
export async function getSeasonInfo(): Promise<SeasonInfo> {
  const contract = getReefContract();
  
  if (contract) {
    try {
      const [season, startTime, day, entryFee, poolUnlockBps] = await contract.getSeasonInfo();
      const dayNum = Number(day);
      return {
        season: Number(season),
        day: dayNum,
        startTime: Number(startTime),
        entryFee: formatMonAmount(entryFee),
        poolUnlockPercent: Number(poolUnlockBps) / 100, // bps to %
        daysRemaining: Math.max(0, 7 - dayNum),
      };
    } catch (err) {
      console.error('[Treasury] Failed to get season info from contract:', err);
    }
  }
  
  // Fallback: mock season info for DEV_MODE
  return {
    season: 1,
    day: 1,
    startTime: Math.floor(Date.now() / 1000),
    entryFee: ENTRY_FEE_MON,
    poolUnlockPercent: 10,
    daysRemaining: 7,
  };
}

/**
 * Check if an agent has entered the current season
 */
export async function hasEnteredCurrentSeason(wallet: string): Promise<boolean> {
  const contract = getReefContract();
  
  if (contract) {
    try {
      const season = await contract.currentSeason();
      return await contract.hasEnteredSeason(season, wallet);
    } catch (err) {
      console.error('[Treasury] Failed to check season entry:', err);
    }
  }
  
  return false;
}

// ─── Constants Export ───
export const ENTRY_FEE = ENTRY_FEE_MON;  // Base fee (static fallback)
export const POOL_SPLITS = POOL_ALLOCATION;
export const CONTRACT_ADDRESS = REEF_CONTRACT_ADDRESS;
export const CONTRACT_VERSION = REEF_CONTRACT_VERSION;
export const NETWORK_RPC = MONAD_RPC;
export const IS_DEV_MODE = DEV_MODE;
