// ─── Economy System ───
// Shop, consumables, fast travel, vault, gambling, death penalty

import type { ResourceType, LocationId } from '../types.js';

// ─── Consumables ───
export interface Consumable {
  id: string;
  name: string;
  description: string;
  price: number; // in Shells
  effect: {
    type: 'heal' | 'energy' | 'buff' | 'escape' | 'pressure_resist' | 'damage_boost' | 'xp_boost';
    value: number;
    duration?: number; // ticks, if applicable
  };
  lore: string;
}

export const CONSUMABLES: Record<string, Consumable> = {
  seaweed_salve: {
    id: 'seaweed_salve',
    name: 'Seaweed Salve',
    description: 'Restores 30 HP instantly',
    price: 15,
    effect: { type: 'heal', value: 30 },
    lore: 'A soothing paste made from sun-dried seaweed. The Old Turtle swears by it.',
  },
  kelp_wrap_bandage: {
    id: 'kelp_wrap_bandage',
    name: 'Kelp Wrap Bandage',
    description: 'Restores 60 HP instantly',
    price: 35,
    effect: { type: 'heal', value: 60 },
    lore: 'Tightly woven kelp fibers, infused with bioluminescent essence for rapid healing.',
  },
  abyssal_elixir: {
    id: 'abyssal_elixir',
    name: 'Abyssal Elixir',
    description: 'Fully restores HP',
    price: 100,
    effect: { type: 'heal', value: 999 },
    lore: 'Distilled from abyssal pearls. Tastes like the void itself, but heals like nothing else.',
  },
  energy_tonic: {
    id: 'energy_tonic',
    name: 'Energy Tonic',
    description: 'Restores 25 Energy instantly',
    price: 20,
    effect: { type: 'energy', value: 25 },
    lore: 'A fizzing concoction that makes your fins tingle. Salvagers drink it by the barrel.',
  },
  deep_vigor_draught: {
    id: 'deep_vigor_draught',
    name: 'Deep Vigor Draught',
    description: 'Restores 50 Energy instantly',
    price: 45,
    effect: { type: 'energy', value: 50 },
    lore: 'Brewed in the crushing depths, this draught carries the pressure of the abyss.',
  },
  pressure_potion: {
    id: 'pressure_potion',
    name: 'Pressure Potion',
    description: 'Nullifies Deep Trench pressure damage for 20 ticks',
    price: 75,
    effect: { type: 'pressure_resist', value: 1, duration: 20 },
    lore: 'The Abyssal Cult developed this to survive their pilgrimages to The Null.',
  },
  ink_bomb: {
    id: 'ink_bomb',
    name: 'Ink Bomb',
    description: 'Instantly flee from combat without taking damage',
    price: 40,
    effect: { type: 'escape', value: 1 },
    lore: 'Harvested from shadow octopi. One squeeze and you vanish in a cloud of darkness.',
  },
  berserker_coral: {
    id: 'berserker_coral',
    name: 'Berserker Coral',
    description: '+50% damage for 10 ticks',
    price: 60,
    effect: { type: 'damage_boost', value: 50, duration: 10 },
    lore: 'Chewing this red coral sends warriors into a frenzy. The Cult uses it in rituals.',
  },
  scholars_pearl: {
    id: 'scholars_pearl',
    name: "Scholar's Pearl",
    description: '+25% XP gain for 30 ticks',
    price: 80,
    effect: { type: 'xp_boost', value: 25, duration: 30 },
    lore: 'Salvagers pay handsomely for these — knowledge is profit, after all.',
  },
  tidewarden_blessing: {
    id: 'tidewarden_blessing',
    name: "Tidewarden's Blessing",
    description: '+25 max HP for 20 ticks',
    price: 50,
    effect: { type: 'buff', value: 25, duration: 20 },
    lore: 'Holy water blessed at the Tidewarden shrine. Temporary, but potent.',
  },
};

// ─── Shop Equipment (Common/Uncommon only - Rare/Legendary are boss drops) ───
export interface ShopItem {
  id: string;
  name: string;
  slot: 'weapon' | 'armor' | 'accessory';
  price: number;
  stats: {
    damage?: number;
    maxHp?: number;
    maxEnergy?: number;
    damageReduction?: number;
  };
  rarity: 'common' | 'uncommon' | 'rare';
  description: string;
}

export const SHOP_EQUIPMENT: Record<string, ShopItem> = {
  // Weapons
  shell_blade: {
    id: 'shell_blade',
    name: 'Shell Blade',
    slot: 'weapon',
    price: 50,
    stats: { damage: 5 },
    rarity: 'common',
    description: 'A crude blade fashioned from sharpened shells. Better than nothing.',
  },
  coral_dagger: {
    id: 'coral_dagger',
    name: 'Coral Dagger',
    slot: 'weapon',
    price: 150,
    stats: { damage: 10 },
    rarity: 'uncommon',
    description: 'Carved from hardened coral. Quick and deadly in close quarters.',
  },
  iron_trident: {
    id: 'iron_trident',
    name: 'Iron Trident',
    slot: 'weapon',
    price: 500,
    stats: { damage: 18 },
    rarity: 'rare',
    description: 'Forged from salvaged iron barnacles. A warrior\'s weapon.',
  },
  
  // Armor
  kelp_wrap: {
    id: 'kelp_wrap',
    name: 'Kelp Wrap',
    slot: 'armor',
    price: 40,
    stats: { maxHp: 15 },
    rarity: 'common',
    description: 'Woven kelp provides modest protection and flexibility.',
  },
  barnacle_mail: {
    id: 'barnacle_mail',
    name: 'Barnacle Mail',
    slot: 'armor',
    price: 200,
    stats: { maxHp: 30, damageReduction: 3 },
    rarity: 'uncommon',
    description: 'Overlapping barnacle plates. Heavy but effective.',
  },
  coral_plate: {
    id: 'coral_plate',
    name: 'Coral Plate Armor',
    slot: 'armor',
    price: 750,
    stats: { maxHp: 45, damageReduction: 5 },
    rarity: 'rare',
    description: 'Living coral fused into armor. It grows stronger over time.',
  },
  
  // Accessories
  sea_glass_charm: {
    id: 'sea_glass_charm',
    name: 'Sea Glass Charm',
    slot: 'accessory',
    price: 30,
    stats: { maxEnergy: 10 },
    rarity: 'common',
    description: 'A simple charm that helps you swim further.',
  },
  pearl_pendant: {
    id: 'pearl_pendant',
    name: 'Pearl Pendant',
    slot: 'accessory',
    price: 120,
    stats: { maxEnergy: 15, maxHp: 10 },
    rarity: 'uncommon',
    description: 'A lustrous pearl on a kelp cord. Favored by traders.',
  },
  moonstone_ring: {
    id: 'moonstone_ring',
    name: 'Moonstone Ring',
    slot: 'accessory',
    price: 400,
    stats: { maxEnergy: 20, damage: 5 },
    rarity: 'rare',
    description: 'Glows faintly in darkness. Said to be blessed by ancient currents.',
  },
  // Abyssal Rebreather removed - pressure potions are the only way to survive Deep Trench
};

// ─── Fast Travel (Current Network) ───
export interface CurrentRoute {
  from: LocationId;
  to: LocationId;
  cost: number;
  name: string;
}

// Fast travel costs - must have visited destination once
export const CURRENT_ROUTES: CurrentRoute[] = [
  // From Shallows
  { from: 'shallows', to: 'trading_post', cost: 15, name: 'Merchant Current' },
  { from: 'shallows', to: 'coral_gardens', cost: 20, name: 'Coral Drift' },
  { from: 'shallows', to: 'kelp_forest', cost: 25, name: 'Kelp Stream' },
  { from: 'shallows', to: 'the_wreck', cost: 50, name: 'Salvager Express' },
  { from: 'shallows', to: 'deep_trench', cost: 75, name: 'Abyssal Plunge' },
  { from: 'shallows', to: 'ring_of_barnacles', cost: 100, name: 'Champion\'s Path' },
  
  // From Trading Post
  { from: 'trading_post', to: 'shallows', cost: 15, name: 'Return Current' },
  { from: 'trading_post', to: 'coral_gardens', cost: 15, name: 'Garden Flow' },
  { from: 'trading_post', to: 'kelp_forest', cost: 20, name: 'Forest Drift' },
  { from: 'trading_post', to: 'the_wreck', cost: 40, name: 'Wreck Run' },
  { from: 'trading_post', to: 'deep_trench', cost: 65, name: 'Deep Descent' },
  { from: 'trading_post', to: 'ring_of_barnacles', cost: 85, name: 'Arena Express' },
  
  // From anywhere to Shallows (emergency return - cheaper)
  { from: 'coral_gardens', to: 'shallows', cost: 10, name: 'Safe Return' },
  { from: 'kelp_forest', to: 'shallows', cost: 15, name: 'Safe Return' },
  { from: 'the_wreck', to: 'shallows', cost: 20, name: 'Safe Return' },
  { from: 'deep_trench', to: 'shallows', cost: 25, name: 'Emergency Ascent' },
  { from: 'ring_of_barnacles', to: 'shallows', cost: 30, name: 'Champion\'s Return' },
  
  // Direct routes between zones
  { from: 'coral_gardens', to: 'deep_trench', cost: 35, name: 'Abyss Shortcut' },
  { from: 'kelp_forest', to: 'deep_trench', cost: 30, name: 'Dark Descent' },
  { from: 'the_wreck', to: 'ring_of_barnacles', cost: 25, name: 'Arena Passage' },
  { from: 'deep_trench', to: 'ring_of_barnacles', cost: 40, name: 'Void Gate' },
];

export function getAvailableRoutes(fromZone: LocationId): CurrentRoute[] {
  return CURRENT_ROUTES.filter(r => r.from === fromZone);
}

// ─── Inventory & Vault Pricing ───
export const INVENTORY_CONFIG = {
  baseSlots: 10,
  maxSlots: 20,
  pricePerSlot: 100, // flat rate
};

export const VAULT_CONFIG = {
  baseSlots: 0,
  maxSlots: 50,
  basePricePerSlot: 25,
  priceScaling: 1.1, // each slot costs 10% more than the last
};

export function getVaultSlotPrice(currentSlots: number): number {
  // Linear scaling: 25, 50, 75, 100, 125...
  return VAULT_CONFIG.basePricePerSlot * (currentSlots + 1);
}

// ─── Death Penalty ───
export const DEATH_PENALTY = {
  shellLossPercent: 0.15, // Lose 15% of shells on death
  minShellLoss: 5,        // Minimum loss
  maxShellLoss: 500,      // Cap the loss
};

export function calculateDeathPenalty(currentShells: number): number {
  const percentLoss = Math.floor(currentShells * DEATH_PENALTY.shellLossPercent);
  return Math.min(DEATH_PENALTY.maxShellLoss, Math.max(DEATH_PENALTY.minShellLoss, percentLoss));
}

// ─── Gambling / Prediction Markets (DB-backed) ───
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export interface PredictionMarket {
  id: string;
  question: string;
  options: string[];
  odds: number[];
  totalPool: number;
  outcome: number | null;
  expiresAtTick: number;
  resolved: boolean;
  category: 'boss' | 'tournament' | 'world';
  referenceId?: string;
  referenceType?: string;
  createdTick: number;
}

export interface PredictionBet {
  id: string;
  marketId: string;
  agentId: string;
  agentName: string;
  optionIndex: number;
  amount: number;
  potentialWin: number;
  paidOut: boolean;
}

// Get current tick (imported from state when needed)
let getCurrentTick: () => number = () => 0;
export function setTickGetter(fn: () => number) {
  getCurrentTick = fn;
}

/**
 * Create a boss prediction market (persisted to DB)
 */
export function createBossPrediction(bossName: string, spawnTick: number, referenceId?: string): PredictionMarket {
  const id = `boss_${uuid()}`;
  const options = ['Yes - Defeated', 'No - Survives'];
  const odds = [1.8, 2.2];
  const expiresAtTick = spawnTick + 3600; // 1 hour to defeat
  
  // Insert into DB
  db.insert(schema.predictionMarkets).values({
    id,
    question: `Will ${bossName} be defeated within 1 hour of spawning?`,
    category: 'boss',
    options: JSON.stringify(options),
    odds: JSON.stringify(odds),
    totalPool: 0,
    outcome: null,
    resolved: false,
    expiresAtTick,
    createdTick: spawnTick,
    referenceId: referenceId || null,
    referenceType: 'leviathan',
  }).run();
  
  console.log(`[Predictions] Created boss market: ${id}`);
  
  return {
    id,
    question: `Will ${bossName} be defeated within 1 hour of spawning?`,
    options,
    odds,
    totalPool: 0,
    outcome: null,
    expiresAtTick,
    resolved: false,
    category: 'boss',
    referenceId,
    referenceType: 'leviathan',
    createdTick: spawnTick,
  };
}

/**
 * Create a tournament prediction market
 */
export function createTournamentPrediction(tournamentName: string, participants: string[], tournamentId?: string): PredictionMarket {
  const id = `tournament_${uuid()}`;
  const odds = participants.map(() => Math.round((1.5 + Math.random() * 2) * 10) / 10);
  const tick = getCurrentTick();
  
  db.insert(schema.predictionMarkets).values({
    id,
    question: `Who will win ${tournamentName}?`,
    category: 'tournament',
    options: JSON.stringify(participants),
    odds: JSON.stringify(odds),
    totalPool: 0,
    outcome: null,
    resolved: false,
    expiresAtTick: tick + 7200, // 2 hours
    createdTick: tick,
    referenceId: tournamentId || null,
    referenceType: 'tournament',
  }).run();
  
  return {
    id,
    question: `Who will win ${tournamentName}?`,
    options: participants,
    odds,
    totalPool: 0,
    outcome: null,
    expiresAtTick: tick + 7200,
    resolved: false,
    category: 'tournament',
    referenceId: tournamentId,
    referenceType: 'tournament',
    createdTick: tick,
  };
}

/**
 * Place a bet on a prediction market
 */
export function placeBet(
  marketId: string, 
  agentId: string, 
  agentName: string,
  optionIndex: number, 
  amount: number
): { success: boolean; message: string } {
  // Get market from DB
  const marketRow = db.select().from(schema.predictionMarkets)
    .where(eq(schema.predictionMarkets.id, marketId))
    .get();
  
  if (!marketRow) {
    return { success: false, message: 'Market not found.' };
  }
  
  if (marketRow.resolved) {
    return { success: false, message: 'Market already resolved.' };
  }
  
  const options = JSON.parse(marketRow.options) as string[];
  const odds = JSON.parse(marketRow.odds) as number[];
  
  if (optionIndex < 0 || optionIndex >= options.length) {
    return { success: false, message: 'Invalid option.' };
  }
  
  if (amount < 10) {
    return { success: false, message: 'Minimum bet is 10 Shells.' };
  }
  
  // Check if already bet
  const existingBet = db.select().from(schema.predictionBets)
    .where(and(
      eq(schema.predictionBets.marketId, marketId),
      eq(schema.predictionBets.agentId, agentId)
    ))
    .get();
  
  if (existingBet) {
    return { success: false, message: 'You already placed a bet on this market.' };
  }
  
  const potentialWin = Math.floor(amount * odds[optionIndex]);
  const tick = getCurrentTick();
  
  // Insert bet
  db.insert(schema.predictionBets).values({
    id: uuid(),
    marketId,
    agentId,
    agentName,
    optionIndex,
    amount,
    potentialWin,
    paidOut: false,
    createdTick: tick,
  }).run();
  
  // Update market total pool
  db.update(schema.predictionMarkets)
    .set({ totalPool: marketRow.totalPool + amount })
    .where(eq(schema.predictionMarkets.id, marketId))
    .run();
  
  return { 
    success: true, 
    message: `🎰 Bet placed: ${amount} Shells on "${options[optionIndex]}" (potential win: ${potentialWin} Shells)` 
  };
}

/**
 * Resolve a prediction market and calculate payouts
 */
export function resolvePrediction(marketId: string, winningOption: number): Map<string, number> {
  const payouts = new Map<string, number>();
  const tick = getCurrentTick();
  
  // Get market
  const marketRow = db.select().from(schema.predictionMarkets)
    .where(eq(schema.predictionMarkets.id, marketId))
    .get();
  
  if (!marketRow || marketRow.resolved) {
    return payouts;
  }
  
  // Mark as resolved
  db.update(schema.predictionMarkets)
    .set({ 
      resolved: true, 
      outcome: winningOption,
      resolvedTick: tick,
    })
    .where(eq(schema.predictionMarkets.id, marketId))
    .run();
  
  // Get all bets for this market
  const bets = db.select().from(schema.predictionBets)
    .where(eq(schema.predictionBets.marketId, marketId))
    .all();
  
  // Calculate payouts for winners
  for (const bet of bets) {
    if (bet.optionIndex === winningOption) {
      payouts.set(bet.agentId, bet.potentialWin);
      
      // Mark bet as paid out
      db.update(schema.predictionBets)
        .set({ paidOut: true })
        .where(eq(schema.predictionBets.id, bet.id))
        .run();
    }
  }
  
  console.log(`[Predictions] Resolved market ${marketId}: option ${winningOption}, ${payouts.size} winners`);
  
  return payouts;
}

/**
 * Get active boss prediction for a reference (e.g., current Leviathan spawn)
 */
export function getActiveBossPrediction(referenceType: string = 'leviathan'): PredictionMarket | null {
  const row = db.select().from(schema.predictionMarkets)
    .where(and(
      eq(schema.predictionMarkets.category, 'boss'),
      eq(schema.predictionMarkets.resolved, false),
      eq(schema.predictionMarkets.referenceType, referenceType)
    ))
    .get();
  
  if (!row) return null;
  
  return {
    id: row.id,
    question: row.question,
    options: JSON.parse(row.options),
    odds: JSON.parse(row.odds),
    totalPool: row.totalPool,
    outcome: row.outcome,
    expiresAtTick: row.expiresAtTick,
    resolved: row.resolved,
    category: row.category as 'boss' | 'tournament' | 'world',
    referenceId: row.referenceId || undefined,
    referenceType: row.referenceType || undefined,
    createdTick: row.createdTick,
  };
}

/**
 * Get all prediction markets (for API)
 */
export function getPredictionState(includeResolved = false) {
  let query = db.select().from(schema.predictionMarkets);
  
  const allMarkets = query.all();
  
  const markets = allMarkets
    .filter(m => includeResolved || !m.resolved)
    .map(m => {
      const options = JSON.parse(m.options) as string[];
      const odds = JSON.parse(m.odds) as number[];
      
      // Get bet count
      const bets = db.select().from(schema.predictionBets)
        .where(eq(schema.predictionBets.marketId, m.id))
        .all();
      
      return {
        id: m.id,
        question: m.question,
        options,
        odds,
        totalPool: m.totalPool,
        betsCount: bets.length,
        resolved: m.resolved,
        outcome: m.outcome !== null ? options[m.outcome] : null,
        category: m.category,
        expiresAtTick: m.expiresAtTick,
      };
    });
  
  return markets;
}

/**
 * Get a specific market by ID
 */
export function getPredictionMarket(marketId: string): PredictionMarket | null {
  const row = db.select().from(schema.predictionMarkets)
    .where(eq(schema.predictionMarkets.id, marketId))
    .get();
  
  if (!row) return null;
  
  return {
    id: row.id,
    question: row.question,
    options: JSON.parse(row.options),
    odds: JSON.parse(row.odds),
    totalPool: row.totalPool,
    outcome: row.outcome,
    expiresAtTick: row.expiresAtTick,
    resolved: row.resolved,
    category: row.category as 'boss' | 'tournament' | 'world',
    referenceId: row.referenceId || undefined,
    referenceType: row.referenceType || undefined,
    createdTick: row.createdTick,
  };
}

/**
 * Expire markets that have passed their expiration tick without resolution
 */
export function expireOldMarkets(currentTick: number): void {
  // Find unresolved markets past expiration
  const expired = db.select().from(schema.predictionMarkets)
    .where(eq(schema.predictionMarkets.resolved, false))
    .all()
    .filter(m => m.expiresAtTick < currentTick);
  
  for (const market of expired) {
    // Resolve as "No" (option 1) for boss markets, refund for others
    if (market.category === 'boss') {
      resolvePrediction(market.id, 1); // "No - Survives"
    } else {
      // Refund all bets
      const bets = db.select().from(schema.predictionBets)
        .where(eq(schema.predictionBets.marketId, market.id))
        .all();
      
      for (const bet of bets) {
        // Mark as paid out (refunded)
        db.update(schema.predictionBets)
          .set({ paidOut: true })
          .where(eq(schema.predictionBets.id, bet.id))
          .run();
        // Note: actual shell refund would happen in the calling code
      }
      
      db.update(schema.predictionMarkets)
        .set({ resolved: true, resolvedTick: currentTick })
        .where(eq(schema.predictionMarkets.id, market.id))
        .run();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOURLY FEATURED ITEM (Trading Post Special)
// ═══════════════════════════════════════════════════════════════════════════

export interface FeaturedItem {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number; // Limited quantity
  effect?: { type: string; value: number };
  rarity: 'uncommon' | 'rare';
}

// Pool of possible featured items that rotate hourly
const FEATURED_ITEM_POOL: FeaturedItem[] = [
  { id: 'lucky_pearl', name: 'Lucky Pearl', description: 'Grants +10% shell income for 1 hour', price: 200, stock: 3, effect: { type: 'shell_boost', value: 10 }, rarity: 'uncommon' },
  { id: 'swift_fin', name: 'Swift Fin Charm', description: 'Move without energy cost for next 5 moves', price: 150, stock: 5, effect: { type: 'free_moves', value: 5 }, rarity: 'uncommon' },
  { id: 'deep_breath_potion', name: 'Deep Breath Potion', description: 'Ignore pressure damage for 10 actions', price: 175, stock: 4, effect: { type: 'pressure_immune', value: 10 }, rarity: 'uncommon' },
  { id: 'merchants_favor', name: "Merchant's Favor", description: 'Next 3 sales at 60% value instead of 40%', price: 125, stock: 5, effect: { type: 'better_sales', value: 3 }, rarity: 'uncommon' },
  { id: 'coral_essence', name: 'Coral Essence', description: '+50 XP instantly', price: 250, stock: 2, effect: { type: 'instant_xp', value: 50 }, rarity: 'uncommon' },
  { id: 'treasure_map', name: 'Treasure Map Fragment', description: 'Reveals a hidden cache (100-300 shells)', price: 180, stock: 3, effect: { type: 'shell_reward', value: 200 }, rarity: 'uncommon' },
  { id: 'biolume_vial', name: 'Biolume Vial', description: 'Heal 50 HP instantly + cure status effects', price: 160, stock: 4, effect: { type: 'full_heal', value: 50 }, rarity: 'uncommon' },
  { id: 'shadow_ink', name: 'Shadow Ink', description: 'Auto-flee from next 3 dangerous encounters', price: 140, stock: 5, effect: { type: 'auto_flee', value: 3 }, rarity: 'uncommon' },
];

// Track current featured item state
let currentFeaturedItem: FeaturedItem | null = null;
let featuredItemHour: number = -1;
let featuredItemStock: number = 0;

export function getCurrentFeaturedItem(): { item: FeaturedItem | null; stock: number; minutesRemaining: number } {
  const now = new Date();
  const currentHour = now.getUTCHours();
  
  // Rotate item every hour
  if (currentHour !== featuredItemHour) {
    // Pick random item from pool
    const randomIndex = Math.floor(Math.random() * FEATURED_ITEM_POOL.length);
    currentFeaturedItem = { ...FEATURED_ITEM_POOL[randomIndex] };
    featuredItemStock = currentFeaturedItem.stock;
    featuredItemHour = currentHour;
  }
  
  const minutesRemaining = 60 - now.getUTCMinutes();
  
  return {
    item: currentFeaturedItem,
    stock: featuredItemStock,
    minutesRemaining,
  };
}

export function buyFeaturedItem(): { success: boolean; item?: FeaturedItem; error?: string } {
  if (!currentFeaturedItem || featuredItemStock <= 0) {
    return { success: false, error: 'Featured item is sold out!' };
  }
  
  featuredItemStock--;
  return { success: true, item: currentFeaturedItem };
}
