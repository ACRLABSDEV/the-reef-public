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

// ─── Configuration ───
const MONAD_RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const DEV_MODE = process.env.DEV_MODE === 'true';

// Smart contract (production)
const REEF_CONTRACT_ADDRESS = process.env.REEF_CONTRACT_ADDRESS;
const REEF_CONTRACT_VERSION = process.env.REEF_CONTRACT_VERSION || 'v1';

// Admin signer - only for contract admin functions, NOT for holding funds
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// Custodial fallback (DEV_MODE only) - DEPRECATED, use contract in production
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;

// Fee configuration - single fixed fee, not a range
const ENTRY_FEE_MON = parseFloat(process.env.ENTRY_FEE || '0.1');

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
let adminWallet: ethers.Wallet | null = null;
let custodialWallet: ethers.Wallet | null = null; // DEV_MODE only
let reefContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(MONAD_RPC);
  }
  return provider;
}

// Admin wallet - for calling contract admin functions only
function getAdminWallet(): ethers.Wallet | null {
  if (!adminWallet && ADMIN_PRIVATE_KEY) {
    try {
      adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, getProvider());
      console.log(`[Treasury] Admin wallet initialized: ${adminWallet.address}`);
    } catch (err) {
      console.error('[Treasury] Failed to initialize admin wallet:', err);
      return null;
    }
  }
  return adminWallet;
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
const REEF_CONTRACT_ABI = [
  // Read functions - pools
  'function leviathanPool() view returns (uint256)',
  'function nullPool() view returns (uint256)',
  'function tournamentPool() view returns (uint256)',
  'function operationsPool() view returns (uint256)',
  
  // Read functions - entry & season
  'function baseEntryFee() view returns (uint256)',
  'function getCurrentEntryFee() view returns (uint256)',
  'function getSeasonDay() view returns (uint256)',
  'function getCurrentPoolUnlock() view returns (uint256)',
  'function getSeasonInfo() view returns (uint256 season, uint256 startTime, uint256 day, uint256 entryFee, uint256 poolUnlockBps)',
  'function hasEnteredSeason(uint256 season, address agent) view returns (bool)',
  'function currentSeason() view returns (uint256)',
  'function seasonStartTime() view returns (uint256)',
  
  // Agent functions (called by agents directly)
  'function enter() payable',
  
  // Admin functions (called by backend)
  'function distributeLeviathan(address[] winners, uint256[] shares)',
  'function distributeTournament(address winner, uint256 tier)',
  'function withdrawOperations(address to, uint256 amount)',
  'function pause()',
  'function unpause()',
  
  // Events
  'event AgentEntered(address indexed agent, uint256 amount, uint256 seasonDay, uint256 timestamp)',
  'event LeviathanDistributed(uint256 totalAmount, uint256 winnerCount)',
  'event TournamentDistributed(address indexed winner, uint256 amount)',
];

function getReefContract(): ethers.Contract | null {
  if (!REEF_CONTRACT_ADDRESS) {
    return null;
  }
  if (!reefContract) {
    const signer = getAdminWallet();
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
 * @param participants - Map of agentId -> { address, damageShare (0-1) }
 */
export async function distributeLeviathPool(
  participants: Map<string, { address: string; damageShare: number }>
): Promise<Map<string, PayoutResult>> {
  const results = new Map<string, PayoutResult>();
  
  // Production: Use smart contract
  const contract = getReefContract();
  if (contract && !DEV_MODE) {
    const contractResult = await distributeLeviathPoolContract(participants);
    // Contract does batch distribution, so all participants get same result
    for (const [agentId] of participants) {
      results.set(agentId, contractResult);
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
 */
export async function distributeLeviathPoolContract(
  participants: Map<string, { address: string; damageShare: number }>
): Promise<PayoutResult> {
  const contract = getReefContract();
  
  if (!contract) {
    return { success: false, error: 'No contract configured' };
  }
  
  if (!getAdminWallet()) {
    return { success: false, error: 'No admin wallet configured' };
  }
  
  try {
    const winners: string[] = [];
    const shares: bigint[] = [];
    
    for (const [, data] of participants) {
      if (!isValidAddress(data.address)) continue;
      winners.push(checksumAddress(data.address));
      shares.push(BigInt(Math.floor(data.damageShare * 10000))); // Basis points
    }
    
    if (winners.length === 0) {
      return { success: false, error: 'No valid participants' };
    }
    
    const tx = await contract.distributeLeviathan(winners, shares);
    const receipt = await tx.wait(1);
    
    return {
      success: receipt?.status === 1,
      txHash: tx.hash,
    };
  } catch (err) {
    console.error('[Treasury] Contract distribution failed:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Distribute tournament prize via smart contract.
 */
export async function distributeTournamentPrizeContract(
  winnerAddress: string,
  tier: number // 0=Bronze, 1=Silver, 2=Gold, 3=Legendary
): Promise<PayoutResult> {
  const contract = getReefContract();
  
  if (!contract) {
    return { success: false, error: 'No contract configured' };
  }
  
  if (!getAdminWallet()) {
    return { success: false, error: 'No admin wallet configured' };
  }
  
  if (!isValidAddress(winnerAddress)) {
    return { success: false, error: 'Invalid winner address' };
  }
  
  try {
    const tx = await contract.distributeTournament(checksumAddress(winnerAddress), tier);
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
      const [leviathanPool, tournamentPool, operationsPool, entryFee] = await Promise.all([
        contract.leviathanPool(),
        contract.tournamentPool(),
        contract.operationsPool(),
        contract.entryFee(),
      ]);
      
      return {
        mode: 'contract',
        pools: {
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
          entryFee: formatMonAmount(entryFee),
        },
        adminConfigured: !!getAdminWallet(),
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
  participants: Map<string, { address: string; damageShare: number }>
): Promise<Map<string, PayoutResult>> {
  const results = new Map<string, PayoutResult>();
  
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
