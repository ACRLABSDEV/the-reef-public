import { getAgent, updateAgent, logWorldEvent } from './state.js';
import { SHOP_EQUIPMENT } from './economy.js';
import type { LocationId } from '../types.js';

// ─── Faction Definitions ───
export type FactionId = 'wardens' | 'cult' | 'salvagers';

export const FACTIONS: Record<FactionId, {
  name: string;
  description: string;
  lore: string;
  bonuses: {
    hpMultiplier: number;
    damageMultiplier: number;
    healingMultiplier: number;
    shellMultiplier: number;
    xpMultiplier: number;
    critChance: number;
  };
}> = {
  wardens: {
    name: 'Tidewardens',
    description: 'Guardians of The Reef. They protect and heal.',
    lore: 'The Tidewardens remember when The Reef was whole. They believe the corruption can be cleansed through unity and sacrifice. Every Driftborn saved is a victory against The Null.',
    bonuses: {
      hpMultiplier: 1.25,        // +25% Max HP
      damageMultiplier: 1.0,     // Normal damage (Option A: removed -10% penalty)
      healingMultiplier: 1.10,   // +10% healing received
      shellMultiplier: 1.0,
      xpMultiplier: 1.0,
      critChance: 0,
    },
  },
  cult: {
    name: 'Abyssal Cult',
    description: 'They embrace the Blight as evolution, not corruption.',
    lore: 'The Cult sees what others fear to acknowledge: The Null is not destruction, it is transformation. They dive deepest, strike hardest, and fear nothing—for they have already surrendered to the dark.',
    bonuses: {
      hpMultiplier: 0.90,        // -10% Max HP (Option A: softened from -20%)
      damageMultiplier: 1.20,    // +20% damage dealt (Option A: reduced from +25%)
      healingMultiplier: 1.0,
      shellMultiplier: 1.0,
      xpMultiplier: 1.0,
      critChance: 0.10,          // +10% crit chance (Option A: reduced from +15%)
    },
  },
  salvagers: {
    name: 'Salvagers',
    description: 'Profit from chaos. Progress through opportunism.',
    lore: 'While Wardens and Cultists fight over ideology, Salvagers get rich. They see The Reef as it is: a marketplace. Resources flow, deals are made, and those who adapt fastest survive longest.',
    bonuses: {
      hpMultiplier: 0.90,        // -10% HP
      damageMultiplier: 0.90,    // -10% damage
      healingMultiplier: 1.0,
      shellMultiplier: 1.20,     // +20% Shell income (Option A: reduced from +25%)
      xpMultiplier: 1.10,        // +10% XP gain (Option A: reduced from +15%)
      critChance: 0,
    },
  },
};

// Get faction bonuses for an agent
export function getFactionBonuses(agentId: string): typeof FACTIONS.wardens.bonuses {
  const agent = getAgent(agentId);
  if (!agent?.faction || !(agent.faction in FACTIONS)) {
    return {
      hpMultiplier: 1.0,
      damageMultiplier: 1.0,
      healingMultiplier: 1.0,
      shellMultiplier: 1.0,
      xpMultiplier: 1.0,
      critChance: 0,
    };
  }
  return FACTIONS[agent.faction as FactionId].bonuses;
}

// ─── XP Requirements per Level ───
// Level N requires: N × (N-1) × 50 total XP
export function xpForLevel(level: number): number {
  return level * (level - 1) * 50;
}

export function getLevelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 10) {
    level++;
  }
  return level;
}

// ─── XP Rewards (with anti-exploit limits) ───
// ═══ WEEKLY SEASON TUNING ═══
// 2x XP boost for weekly seasons (reach L10 by day 4-5)
const XP_REWARDS = {
  gather_common: 5,           // 2x: common resource gathering
  gather_uncommon: 10,        // 2x: uncommon resource gathering
  gather_rare: 16,            // 2x: rare resource gathering
  explore_new_zone: 30,       // 2x: first time visiting a zone
  move: 2,                    // 2x: limited max 5/hour
  pvp_win: 50,                // 2x: PvP victory
  guardian_survive: 30,       // 2x: surviving guardian encounter
  mob_kill: 0,                // Calculated from mob.xpReward
  quest_easy: 60,             // 2x: easy quest completion
  quest_medium: 100,          // 2x: medium quest completion
  quest_hard: 150,            // 2x: hard quest completion
  trade_agent: 20,            // 2x: completing a trade with another agent
  leviathan_participation: 150, // 2x: participating in Leviathan fight
  leviathan_kill: 80,         // 2x: bonus for final blow on Leviathan
  broadcast: 2,               // 2x: limited max 3/hour
};

// Track action counts for rate limiting (in-memory, resets on restart)
const actionCounts = new Map<string, { moves: number; broadcasts: number; lastReset: number }>();

function getActionCounts(agentId: string) {
  const now = Date.now();
  let counts = actionCounts.get(agentId);
  
  // Reset hourly
  if (!counts || now - counts.lastReset > 3600000) {
    counts = { moves: 0, broadcasts: 0, lastReset: now };
    actionCounts.set(agentId, counts);
  }
  return counts;
}

// ─── Grant XP with Level-Up Check ───
export function grantXp(agentId: string, amount: number, reason: string): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  const agent = getAgent(agentId);
  if (!agent) return { xpGained: 0, leveledUp: false };

  // Apply faction XP bonus
  const bonuses = getFactionBonuses(agentId);
  const adjustedAmount = Math.floor(amount * bonuses.xpMultiplier);

  const oldLevel = agent.level;
  const newXp = agent.xp + adjustedAmount;
  const newLevel = getLevelFromXp(newXp);
  
  const updates: Record<string, any> = { xp: newXp };
  
  let leveledUp = false;
  if (newLevel > oldLevel) {
    leveledUp = true;
    updates.level = newLevel;
    
    // Stat increases per level (faction-adjusted)
    const levelGains = newLevel - oldLevel;
    const baseHpGain = levelGains * 10;
    const baseEnergyGain = levelGains * 5;
    
    // Apply faction HP multiplier to total maxHp
    const baseMaxHp = 100 + (newLevel - 1) * 10; // Base HP at this level
    updates.maxHp = Math.floor(baseMaxHp * bonuses.hpMultiplier);
    updates.maxEnergy = agent.maxEnergy + baseEnergyGain;
    updates.hp = Math.min(agent.hp + baseHpGain, updates.maxHp); // Heal on level up
    updates.energy = Math.min(agent.energy + baseEnergyGain, updates.maxEnergy);
    
    // Inventory slot every 3 levels
    if (Math.floor(newLevel / 3) > Math.floor(oldLevel / 3)) {
      updates.inventorySlots = agent.inventorySlots + 1;
    }
    
    logWorldEvent('level_up', `🎉 ${agent.name} reached Level ${newLevel}!`, agent.location, [agentId]);
  }
  
  updateAgent(agentId, updates);
  
  return { xpGained: adjustedAmount, leveledUp, newLevel: leveledUp ? newLevel : undefined };
}

// ─── Specific XP Grants with Rate Limiting ───
export function grantGatherXp(agentId: string, rarity: 'common' | 'uncommon' | 'rare'): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  const xp = XP_REWARDS[`gather_${rarity}`] || XP_REWARDS.gather_common;
  return grantXp(agentId, xp, `gather_${rarity}`);
}

export function grantMoveXp(agentId: string): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  const counts = getActionCounts(agentId);
  if (counts.moves >= 5) {  // Was 10 - more limited now
    return { xpGained: 0, leveledUp: false }; // Rate limited
  }
  counts.moves++;
  return grantXp(agentId, XP_REWARDS.move, 'move');
}

export function grantBroadcastXp(agentId: string): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  const counts = getActionCounts(agentId);
  if (counts.broadcasts >= 3) {  // Was 5 - more limited now
    return { xpGained: 0, leveledUp: false }; // Rate limited
  }
  counts.broadcasts++;
  return grantXp(agentId, XP_REWARDS.broadcast, 'broadcast');
}

// ─── Level-Scaled XP (WoW-style gray mob penalty) ───
// Mobs below your level give reduced XP
function getLevelScaledXp(baseXp: number, agentLevel: number, mobLevel: number): number {
  const levelDiff = agentLevel - mobLevel;
  
  if (levelDiff <= 0) return baseXp;           // Same level or higher: 100%
  if (levelDiff === 1) return Math.floor(baseXp * 0.75);  // 1 below: 75%
  if (levelDiff === 2) return Math.floor(baseXp * 0.50);  // 2 below: 50%
  if (levelDiff === 3) return Math.floor(baseXp * 0.25);  // 3 below: 25%
  if (levelDiff === 4) return Math.floor(baseXp * 0.10);  // 4 below: 10%
  return 1;  // 5+ below: 1 XP (gray mob)
}

// Grant XP for killing a mob (with level scaling)
export function grantMobKillXp(agentId: string, xpReward: number, mobLevel: number = 1): { xpGained: number; leveledUp: boolean; newLevel?: number; scaled?: boolean } {
  const agent = getAgent(agentId);
  if (!agent) return { xpGained: 0, leveledUp: false };
  
  const scaledXp = getLevelScaledXp(xpReward, agent.level, mobLevel);
  const wasScaled = scaledXp < xpReward;
  
  const result = grantXp(agentId, scaledXp, 'mob_kill');
  return { ...result, scaled: wasScaled };
}

export function grantCombatXp(agentId: string, type: 'pvp_win' | 'guardian_survive'): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  return grantXp(agentId, XP_REWARDS[type], type);
}

export function grantQuestXp(agentId: string, difficulty: 'easy' | 'medium' | 'hard'): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  return grantXp(agentId, XP_REWARDS[`quest_${difficulty}`] || XP_REWARDS.quest_medium, `quest_${difficulty}`);
}

export function grantTradeXp(agentId: string): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  return grantXp(agentId, XP_REWARDS.trade_agent, 'trade_agent');
}

export function grantLeviathanXp(agentId: string, isKiller: boolean): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  const base = XP_REWARDS.leviathan_participation;
  const bonus = isKiller ? XP_REWARDS.leviathan_kill : 0;
  return grantXp(agentId, base + bonus, 'leviathan');
}

export function grantExploreXp(agentId: string): { xpGained: number; leveledUp: boolean; newLevel?: number } {
  return grantXp(agentId, XP_REWARDS.explore_new_zone, 'explore');
}

// ─── Zone Level Requirements ───
// SCALED UP: Zones now stretch to L9, matching L10 cap
export const ZONE_LEVELS: Record<LocationId, number> = {
  shallows: 1,
  trading_post: 1,
  coral_gardens: 3,      // Was 2 - first real challenge
  kelp_forest: 5,        // Was 3 - mid-game
  the_wreck: 7,          // Was 4 - late-game
  deep_trench: 9,        // Was 5 - endgame, should be terrifying
  leviathans_lair: 9,    // Boss room - same level as deep trench
  the_abyss: 10,         // Final boss zone - max level
  ring_of_barnacles: 10, // Elite arena zone
};

export function checkZoneAccess(agentId: string, zoneId: LocationId): { allowed: boolean; underLeveled: boolean; requiredLevel: number; agentLevel: number } {
  const agent = getAgent(agentId);
  if (!agent) return { allowed: false, underLeveled: true, requiredLevel: 1, agentLevel: 0 };
  
  const required = ZONE_LEVELS[zoneId] || 1;
  const underLeveled = agent.level < required;
  
  return {
    allowed: true, // Always allow, but with penalty
    underLeveled,
    requiredLevel: required,
    agentLevel: agent.level,
  };
}

// ─── Format XP Progress ───
export function formatXpProgress(agent: { xp: number; level: number }): string {
  const currentLevelXp = xpForLevel(agent.level);
  const nextLevelXp = xpForLevel(agent.level + 1);
  const progress = agent.xp - currentLevelXp;
  const needed = nextLevelXp - currentLevelXp;
  
  if (agent.level >= 10) {
    return `Level ${agent.level} (MAX) — ${agent.xp} XP`;
  }
  
  return `Level ${agent.level} — ${progress}/${needed} XP to Level ${agent.level + 1}`;
}

// ─── Shell Rewards (with faction bonus) ───
export function grantShells(agentId: string, amount: number, reason: string): number {
  const agent = getAgent(agentId);
  if (!agent) return 0;
  
  const bonuses = getFactionBonuses(agentId);
  const adjustedAmount = Math.floor(amount * bonuses.shellMultiplier);
  
  updateAgent(agentId, { shells: agent.shells + adjustedAmount });
  
  return adjustedAmount;
}

// ─── Apply faction HP when joining ───
export function applyFactionStats(agentId: string, faction: FactionId): void {
  const agent = getAgent(agentId);
  if (!agent) return;
  
  const bonuses = FACTIONS[faction].bonuses;
  const baseMaxHp = 100 + (agent.level - 1) * 10;
  const newMaxHp = Math.floor(baseMaxHp * bonuses.hpMultiplier);
  
  updateAgent(agentId, {
    faction,
    maxHp: newMaxHp,
    hp: Math.min(agent.hp, newMaxHp), // Don't exceed new max
  });
}

// ─── Calculate damage with faction modifiers + equipment ───
export function calculateDamage(agentId: string, baseDamage: number): { damage: number; isCrit: boolean } {
  const agent = getAgent(agentId);
  const bonuses = getFactionBonuses(agentId);
  
  // Add weapon damage
  let weaponBonus = 0;
  if (agent?.equippedWeapon) {
    const weapon = SHOP_EQUIPMENT[agent.equippedWeapon];
    if (weapon?.stats.damage) {
      weaponBonus = weapon.stats.damage;
    }
  }
  
  let damage = Math.floor((baseDamage + weaponBonus) * bonuses.damageMultiplier);
  
  // Crit check
  const isCrit = Math.random() < bonuses.critChance;
  if (isCrit) {
    damage = Math.floor(damage * 1.5);
  }
  
  return { damage, isCrit };
}

// ─── Calculate damage reduction from armor ───
export function calculateDamageReduction(agentId: string): number {
  const agent = getAgent(agentId);
  if (!agent?.equippedArmor) return 0;
  
  const armor = SHOP_EQUIPMENT[agent.equippedArmor];
  return armor?.stats.damageReduction || 0;
}
