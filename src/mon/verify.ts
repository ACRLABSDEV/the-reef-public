import { ethers } from 'ethers';

// ─── MON Token Verification ───
// For hackathon: simple signature verification + mock payment
// Production: actual on-chain MON transfer verification

const MONAD_RPC = process.env.MONAD_RPC_URL || 'https://testnet.monad.xyz/v1';

// Verify that a wallet signed a message (proves ownership)
export async function verifySignature(
  wallet: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === wallet.toLowerCase();
  } catch {
    return false;
  }
}

// Generate the entry message an agent must sign
export function getEntryMessage(wallet: string): string {
  return `Enter The Reef with wallet ${wallet} at ${new Date().toISOString().split('T')[0]}`;
}

// Verify MON payment (hackathon: mock / testnet)
export async function verifyEntryPayment(
  wallet: string,
  _txHash?: string
): Promise<{ verified: boolean; reason?: string }> {
  // For hackathon phase, we accept signature-based entry
  // In production, we'd verify an actual MON transfer on-chain:
  //
  // const provider = new ethers.JsonRpcProvider(MONAD_RPC);
  // const tx = await provider.getTransaction(txHash);
  // verify tx.to === REEF_TREASURY, tx.value >= ENTRY_FEE, etc.

  if (process.env.REQUIRE_PAYMENT === 'true' && _txHash) {
    try {
      const provider = new ethers.JsonRpcProvider(MONAD_RPC);
      const tx = await provider.getTransaction(_txHash);
      if (!tx) return { verified: false, reason: 'Transaction not found' };
      if (tx.from?.toLowerCase() !== wallet.toLowerCase()) {
        return { verified: false, reason: 'Transaction sender does not match wallet' };
      }
      return { verified: true };
    } catch (err) {
      return { verified: false, reason: 'Failed to verify transaction' };
    }
  }

  // Hackathon mode: allow entry with just signature
  return { verified: true };
}

// Simple API key auth for agents - persisted to DB
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

// In-memory cache for fast lookups (rebuilt from DB on startup)
const API_KEY_CACHE = new Map<string, string>(); // key -> agentId

// Load API keys from DB on startup
export function loadApiKeysFromDb(): void {
  const agents = db.select({ id: schema.agents.id, apiKey: schema.agents.apiKey })
    .from(schema.agents)
    .all();
  
  API_KEY_CACHE.clear();
  for (const agent of agents) {
    if (agent.apiKey) {
      API_KEY_CACHE.set(agent.apiKey, agent.id);
    }
  }
  console.log(`[Auth] Loaded ${API_KEY_CACHE.size} API keys from DB`);
}

export function generateApiKey(agentId: string): string {
  const key = `reef_${ethers.hexlify(ethers.randomBytes(16)).slice(2)}`;
  
  // Save to DB
  db.update(schema.agents)
    .set({ apiKey: key })
    .where(eq(schema.agents.id, agentId))
    .run();
  
  // Update cache
  API_KEY_CACHE.set(key, agentId);
  
  return key;
}

export function validateApiKey(key: string): string | null {
  return API_KEY_CACHE.get(key) || null;
}
