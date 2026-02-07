import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { LOCATIONS, GAME, RESOURCE_INFO, EQUIPMENT, CRAFTING_RECIPES } from '../world/config.js';
import { checkTutorialProgress, getTutorialHint, getTutorialProgress } from './tutorial.js';
import {
  getAgent,
  getAgentByName,
  updateAgent,
  getAgentsAtLocation,
  getAllAgents,
  getInventory,
  addToInventory,
  removeFromInventory,
  getLocationResource,
  depleteLocationResource,
  logWorldEvent,
  incrementTick,
  getTick,
  getWorldMeta,
  getInventoryCount,
  getVaultContents,
  addToVault,
  removeFromVault,
} from './state.js';
import {
  getLeviathanPool,
  getTournamentPool,
  distributeLeviathPool,
  distributeTournamentPrize,
  getTreasuryStatus,
} from '../services/treasury.js';
import {
  grantMoveXp,
  grantGatherXp,
  grantCombatXp,
  grantQuestXp,
  grantTradeXp,
  grantBroadcastXp,
  grantLeviathanXp,
  grantExploreXp,
  grantMobKillXp,
  checkZoneAccess,
  formatXpProgress,
  ZONE_LEVELS,
  FACTIONS,
  FactionId,
  applyFactionStats,
  grantShells,
  grantXp,
  calculateDamage,
  calculateDamageReduction,
  getFactionBonuses,
  xpForLevel,
} from './progression.js';
import {
  getRandomMob,
  getResourceGuardian,
  getEncounterChance,
  scaleMobStats,
  type Mob,
} from './mobs.js';
import {
  CONSUMABLES,
  SHOP_EQUIPMENT,
  CURRENT_ROUTES,
  getAvailableRoutes,
  INVENTORY_CONFIG,
  VAULT_CONFIG,
  getVaultSlotPrice,
  calculateDeathPenalty,
  placeBet,
  getPredictionState,
  activePredictions,
  getCurrentFeaturedItem,
  buyFeaturedItem,
} from './economy.js';
import type { ActionRequest, ActionResult, LocationId, ResourceType, StateChange, WorldEvent } from '../types.js';

// ─── Active Encounters (blocking movement/actions until resolved) ───
interface ActiveEncounter {
  agentId: string;
  mob: Mob;
  mobHp: number;
  mobMaxHp: number;
  mobDamage: number;
  zone: LocationId;
  startedAt: number;
  isResourceGuardian: boolean;
  guardedResource?: ResourceType;
}

const activeEncounters = new Map<string, ActiveEncounter>();

// Track recently killed resource guardians (agent can gather without fighting again)
// Key: `${agentId}:${resource}:${zone}`, Value: tick when killed
const killedGuardians = new Map<string, number>();
const GUARDIAN_RESPAWN_TICKS = 50; // Guardian respawns after 50 ticks

// ─── PvP Flagging for Rare Resources ───
const RARE_RESOURCES: ResourceType[] = ['moonstone', 'void_crystals', 'abyssal_pearls'];
const PVP_FLAG_TICKS = 30; // Flagged for PvP for 30 ticks after gathering rare resources

function wasGuardianKilledRecently(agentId: string, resource: ResourceType, zone: LocationId): boolean {
  const key = `${agentId}:${resource}:${zone}`;
  const killedAt = killedGuardians.get(key);
  if (!killedAt) return false;
  return (getTick() - killedAt) < GUARDIAN_RESPAWN_TICKS;
}

function markGuardianKilled(agentId: string, resource: ResourceType, zone: LocationId): void {
  const key = `${agentId}:${resource}:${zone}`;
  killedGuardians.set(key, getTick());
}

// Get agent's active encounter (if any)
export function getActiveEncounter(agentId: string): ActiveEncounter | null {
  return activeEncounters.get(agentId) || null;
}

// Start an encounter
function startEncounter(agentId: string, mob: Mob, zone: LocationId, isResourceGuardian: boolean = false, guardedResource?: ResourceType): ActiveEncounter {
  const agent = getAgent(agentId)!;
  const zoneLevel = ZONE_LEVELS[zone] || 1;
  const scaled = scaleMobStats(mob, agent.level, zoneLevel);
  
  const encounter: ActiveEncounter = {
    agentId,
    mob,
    mobHp: scaled.hp,
    mobMaxHp: scaled.hp,
    mobDamage: scaled.damage,
    zone,
    startedAt: getTick(),
    isResourceGuardian,
    guardedResource,
  };
  
  activeEncounters.set(agentId, encounter);
  return encounter;
}

// End an encounter
function endEncounter(agentId: string): void {
  activeEncounters.delete(agentId);
}

// ─── Death Handler (applies penalty) ───
function handleDeath(agentId: string, cause: string): { shellsLost: number; deathCount: number } {
  const agent = getAgent(agentId)!;
  const penalty = calculateDeathPenalty(agent.shells);
  const newShells = Math.max(0, agent.shells - penalty);
  const deaths = (agent.deaths || 0) + 1;
  
  updateAgent(agentId, {
    isAlive: false,
    location: 'shallows',
    isHidden: false,
    shells: newShells,
    deaths,
  });
  
  logWorldEvent('agent_death', `💀 ${agent.name} ${cause}. Lost ${penalty} Shells.`, 'shallows', [agentId]);
  
  return { shellsLost: penalty, deathCount: deaths };
}

// ─── Input Sanitization ───
function sanitizeInput(input: string | undefined, maxLength = 100): string | undefined {
  if (!input) return undefined;
  // Truncate to max length and remove any HTML/script tags
  return input.slice(0, maxLength).replace(/<[^>]*>/g, '');
}

// ─── Action Router ───
export function processAction(req: ActionRequest): ActionResult {
  // Sanitize inputs
  req.target = sanitizeInput(req.target);
  if (req.params) {
    for (const key of Object.keys(req.params)) {
      req.params[key] = sanitizeInput(req.params[key], 200) || '';
    }
  }
  
  const agent = getAgent(req.agentId);
  if (!agent) {
    return { success: false, narrative: 'Unknown agent.', stateChanges: [], worldEvents: [] };
  }
  if (!agent.isAlive && req.action !== 'rest') {
    return {
      success: false,
      narrative: 'You are unconscious at The Shallows. Use "rest" to recover.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check for active encounter - must fight or flee
  const encounter = getActiveEncounter(req.agentId);
  if (encounter) {
    // Only allow attack (fight) or flee during encounter
    if (req.action === 'attack') {
      return handleEncounterCombat(req.agentId);
    } else if (req.action === 'flee') {
      return handleFlee(req.agentId);
    } else if (req.action === 'look') {
      // Allow look to see encounter status
      return handleEncounterLook(req.agentId, encounter);
    } else {
      return {
        success: false,
        narrative: `⚔️ **You're in combat with ${encounter.mob.name}!**\n\n${encounter.mob.flavorText}\n\n🐙 ${encounter.mob.name}: ${encounter.mobHp}/${encounter.mobMaxHp} HP\n❤️ Your HP: ${agent.hp}/${agent.maxHp}\n\n**Options:**\n• \`attack\` — Fight the enemy\n• \`flee\` — Escape (takes damage, returns to previous zone)`,
        stateChanges: [],
        worldEvents: [],
      };
    }
  }

  let result: ActionResult;

  switch (req.action) {
    case 'look':
      result = handleLook(agent.id);
      break;
    case 'status':
      result = handleStatus(agent.id);
      break;
    case 'move':
      result = handleMove(agent.id, req.target);
      break;
    case 'gather':
      result = handleGather(agent.id, req.target);
      break;
    case 'rest':
      result = handleRest(agent.id);
      break;
    case 'attack':
      result = handleAttack(agent.id, req.target);
      break;
    case 'hide':
      result = handleHide(agent.id);
      break;
    case 'talk':
      result = handleTalk(agent.id, req.target);
      break;
    case 'trade':
      result = handleTrade(agent.id, req.target, req.params);
      break;
    case 'quest':
      result = handleQuest(agent.id, req.target, req.params);
      break;
    case 'use':
    case 'inventory':
    case 'inv':
      result = handleUse(agent.id, req.target);
      break;
    case 'broadcast':
      result = handleBroadcast(agent.id, req.params?.message);
      break;
    case 'whisper':
    case 'dm':
    case 'message':
      result = handleWhisper(agent.id, req.target, req.params?.message);
      break;
    case 'inbox':
      result = handleInbox(agent.id, req.target);
      break;
    case 'bounty':
      result = handleBounty(agent.id, req.target, req.params);
      break;
    case 'challenge':
      result = handleBossChallenge(agent.id);
      break;
    case 'faction':
      result = handleFaction(agent.id, req.target, req.params);
      break;
    case 'party':
      result = handleParty(agent.id, req.target, req.params);
      break;
    case 'dungeon':
      result = handleDungeon(agent.id, req.target, req.params);
      break;
    case 'abyss':
      result = handleAbyss(agent.id, req.target, req.params);
      break;
    case 'arena':
      result = handleArena(agent.id, req.target, req.params);
      break;
    case 'drop':
      result = handleDrop(agent.id, req.target, req.params);
      break;
    case 'flee':
      result = handleFlee(agent.id);
      break;
    case 'shop':
      result = handleShop(agent.id, req.target);
      break;
    case 'buy':
      result = handleBuy(agent.id, req.target, req.params);
      break;
    case 'craft':
      result = handleCraft(agent.id, req.target, req.params);
      break;
    case 'sell':
      result = handleSell(agent.id, req.target, req.params);
      break;
    case 'travel':
      result = handleTravel(agent.id, req.target);
      break;
    case 'vault':
      result = handleVault(agent.id, req.target, req.params);
      break;
    case 'market':
      result = handleMarket(agent.id, req.target, req.params);
      break;
    case 'pursue':
      result = handlePursue(agent.id, req.target);
      break;
    case 'bet':
      result = handleBet(agent.id, req.target, req.params);
      break;
    default:
      result = {
        success: false,
        narrative: `Unknown action: ${req.action}. Available: look, move, gather, rest, attack, hide, talk, trade, quest, use, drop, flee, shop, buy, travel, vault, bet`,
        stateChanges: [],
        worldEvents: [],
      };
  }

  // Advance world tick on every successful action
  if (result.success) {
    const tick = incrementTick();
    updateAgent(agent.id, { lastActionTick: tick, lastActionAt: Date.now() });

    // Deep trench pressure damage (negated by pressure_resist buff OR abyssal_rebreather)
    const currentAgent = getAgent(agent.id);
    if (currentAgent && currentAgent.location === 'deep_trench' && req.action !== 'move') {
      // Check for pressure resistance: buff OR abyssal_rebreather accessory
      const hasRebreather = currentAgent.equippedAccessory === 'abyssal_rebreather';
      const hasPressureBuff = hasBuff(agent.id, 'pressure_resist');
      
      if (hasRebreather || hasPressureBuff) {
        const source = hasRebreather ? 'Abyssal Rebreather' : 'pressure potion';
        result.narrative += `\n\n🛡️ Your ${source} protects you from the crushing depths.`;
      } else {
        const newHp = Math.max(0, currentAgent.hp - GAME.DEEP_TRENCH_PRESSURE_DAMAGE);
        updateAgent(agent.id, { hp: newHp });
        result.narrative += `\n\n⚠️ The crushing pressure damages you (-${GAME.DEEP_TRENCH_PRESSURE_DAMAGE} HP). HP: ${newHp}/${currentAgent.maxHp}`;
        result.narrative += `\n💡 _Tip: Buy a Pressure Potion or Abyssal Rebreather at the Trading Post!_`;
        if (newHp <= 0) {
          const { shellsLost, deathCount } = handleDeath(agent.id, 'was crushed by the deep trench pressure');
          result.narrative += `\n\n💀 The pressure was too much. You black out and wake at The Shallows. (Deaths: ${deathCount})`;
        }
      }
    }
    
    // Tutorial progress check
    const tutorialResult = checkTutorialProgress(agent.id, req.action, result.success);
    if (tutorialResult.stepCompleted) {
      result.narrative += tutorialResult.rewardText;
    }
  }

  return result;
}

// ─── Status ───
function handleStatus(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;
  const xpForNext = xpForLevel(agent.level + 1);
  const xpProgress = agent.xp - xpForLevel(agent.level);
  const xpNeeded = xpForNext - xpForLevel(agent.level);
  
  let narrative = `📊 **${agent.name}** — Level ${agent.level}\n\n`;
  narrative += `❤️ HP: ${agent.hp}/${agent.maxHp}\n`;
  narrative += `⚡ Energy: ${agent.energy}/${agent.maxEnergy}\n`;
  narrative += `🐚 Shells: ${agent.shells}\n`;
  narrative += `⭐ XP: ${agent.xp} (${xpProgress}/${xpNeeded} to Level ${agent.level + 1})\n`;
  narrative += `🏆 Reputation: ${agent.reputation}\n`;
  narrative += `💀 Deaths: ${agent.deaths}\n\n`;
  
  // Faction
  if (agent.faction) {
    const bonuses = getFactionBonuses(agentId);
    narrative += `⚔️ **Faction:** ${agent.faction.charAt(0).toUpperCase() + agent.faction.slice(1)}\n`;
    if (bonuses.hpMultiplier > 1) narrative += `  • +${Math.round((bonuses.hpMultiplier - 1) * 100)}% HP\n`;
    if (bonuses.damageMultiplier > 1) narrative += `  • +${Math.round((bonuses.damageMultiplier - 1) * 100)}% Damage\n`;
    if (bonuses.shellMultiplier > 1) narrative += `  • +${Math.round((bonuses.shellMultiplier - 1) * 100)}% Shells\n`;
    if (bonuses.xpMultiplier > 1) narrative += `  • +${Math.round((bonuses.xpMultiplier - 1) * 100)}% XP\n`;
    if (bonuses.critChance > 0) narrative += `  • +${Math.round(bonuses.critChance * 100)}% Crit\n`;
    narrative += '\n';
  } else {
    narrative += `⚔️ **Faction:** None (join at Level 5+)\n\n`;
  }
  
  // Equipment
  narrative += `🛡️ **Equipment:**\n`;
  narrative += `  • Weapon: ${agent.equippedWeapon ? SHOP_EQUIPMENT[agent.equippedWeapon]?.name : '(none)'}\n`;
  narrative += `  • Armor: ${agent.equippedArmor ? SHOP_EQUIPMENT[agent.equippedArmor]?.name : '(none)'}\n`;
  narrative += `  • Accessory: ${agent.equippedAccessory ? SHOP_EQUIPMENT[agent.equippedAccessory]?.name : '(none)'}\n`;
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Look ───
function handleLook(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  const agents = getAgentsAtLocation(agent.location).filter((a) => a.id !== agentId);
  const meta = getWorldMeta();

  let narrative = `📍 **${loc.name}**\n${loc.description}\n\n`;
  narrative += `🕐 Cycle: ${meta.day_cycle} | Tick: ${meta.tick}\n`;
  narrative += `❤️ HP: ${agent.hp}/${agent.maxHp} | ⚡ Energy: ${agent.energy}/${agent.maxEnergy}\n`;
  narrative += `⭐ ${formatXpProgress(agent)} | 🐚 Shells: ${agent.shells} | Rep: ${agent.reputation}\n\n`;

  // Resources
  if (loc.resources.length > 0) {
    narrative += '**Resources visible:**\n';
    for (const spawn of loc.resources) {
      const locRes = getLocationResource(loc.id, spawn.resource);
      const qty = locRes ? locRes.currentQuantity : spawn.currentQuantity;
      const info = RESOURCE_INFO[spawn.resource];
      narrative += `  • ${info.name} — ${qty} available (${info.rarity})\n`;
    }
    narrative += '\n';
  }

  // Agents
  const currentTick = getTick();
  if (agents.length > 0) {
    narrative += '**Agents present:**\n';
    for (const a of agents) {
      const pvpFlag = (a.pvpFlaggedUntil && a.pvpFlaggedUntil > currentTick) ? ' ⚔️ **PVP FLAGGED**' : '';
      narrative += `  • ${a.name} (HP: ${a.hp}/${a.maxHp}, Rep: ${a.reputation})${pvpFlag}\n`;
    }
    narrative += '\n';
  }

  // NPCs
  if (loc.npcs.length > 0) {
    narrative += '**NPCs:**\n';
    for (const npc of loc.npcs) {
      narrative += `  • ${npc.name} (${npc.type})\n`;
    }
    narrative += '\n';
  }

  // Connections
  narrative += '**Paths:**\n';
  for (const conn of loc.connections) {
    narrative += `  → ${LOCATIONS[conn].name} (\`move ${conn}\`)\n`;
  }

  // Check for PvP engagement
  const engagement = getEngagement(agentId);
  if (engagement) {
    const opponentId = engagement.attackerId === agentId ? engagement.defenderId : engagement.attackerId;
    const opponent = getAgent(opponentId);
    narrative += `\n⚔️ **IN COMBAT** with ${opponent?.name || 'opponent'}! Use \`attack\` or \`flee\`.\n`;
  }

  // Check for unread inbox messages
  const unreadMessages = db.select().from(schema.agentMessages)
    .where(eq(schema.agentMessages.toAgentId, agentId))
    .all();
  if (unreadMessages.length > 0) {
    narrative += `\n📬 **${unreadMessages.length} message(s)** in inbox! Use \`inbox\` to read.\n`;
  }

  // Check for pending trade offers
  const pendingTrades = db.select().from(schema.tradeOffers)
    .where(eq(schema.tradeOffers.toAgent, agentId))
    .all()
    .filter(t => t.status === 'pending');
  if (pendingTrades.length > 0) {
    narrative += `\n🤝 **${pendingTrades.length} pending trade(s)**! Use \`trade pending\` to view.\n`;
  }

  // Tutorial hint (if not completed)
  const tutorialHint = getTutorialHint(agentId);
  if (tutorialHint) {
    narrative += tutorialHint;
  }

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Move ───
function handleMove(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;

  // Check for PvP engagement - can't move while engaged
  const engagement = getEngagement(agentId);
  if (engagement) {
    const opponentId = engagement.attackerId === agentId ? engagement.defenderId : engagement.attackerId;
    const opponent = getAgent(opponentId);
    return {
      success: false,
      narrative: `🔒 **ENGAGED IN COMBAT!**\n\nYou're locked in battle with **${opponent?.name || 'your opponent'}**!\n\nYou must \`flee\` or defeat them to move.\n\n_Flee has a 50% base success rate (modified by level difference). Failed flee = opponent gets free attack._`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (!target) {
    const loc = LOCATIONS[agent.location];
    return {
      success: false,
      narrative: `Where do you want to go? Available: ${loc.connections.map((c) => LOCATIONS[c].name + ' (`' + c + '`)').join(', ')}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const targetLoc = target as LocationId;
  if (!LOCATIONS[targetLoc]) {
    return { success: false, narrative: `Unknown location: ${target}`, stateChanges: [], worldEvents: [] };
  }

  const currentLoc = LOCATIONS[agent.location];
  if (!currentLoc.connections.includes(targetLoc)) {
    return {
      success: false,
      narrative: `You can't reach ${LOCATIONS[targetLoc].name} from here. Available paths: ${currentLoc.connections.map((c) => c).join(', ')}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // ─── Reputation Gates ───
  const REP_GATES: Partial<Record<LocationId, number>> = {
    deep_trench: 25,      // Deep Trench requires 25+ rep
    ring_of_barnacles: 50, // Arena requires 50+ rep
  };
  
  const repRequired = REP_GATES[targetLoc];
  if (repRequired && agent.reputation < repRequired) {
    const zoneName = LOCATIONS[targetLoc].name;
    return {
      success: false,
      narrative: `🔒 **REPUTATION REQUIRED**\n\nThe denizens of ${zoneName} don't trust you yet.\n\n📊 Your reputation: ${agent.reputation}\n⭐ Required: ${repRequired}\n\n_Build reputation through: party dungeon clears (+5), trades (+2), boss damage (+10), quests (+10)_`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // ─── Boss Room Gates ───
  // Leviathan's Lair - only accessible when Leviathan is alive
  if (targetLoc === 'leviathans_lair' && !LEVIATHAN.isAlive) {
    return {
      success: false,
      narrative: `🚧 **THE LAIR IS SEALED**\n\nThe Leviathan slumbers deep within. The cavern entrance is blocked by ancient coral.\n\n🐉 *Something ancient stirs in the darkness... but not yet.*\n\nWhen the Leviathan awakens, the lair will open. Watch for tremors in the deep.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // The Abyss - only accessible when Abyss gates are open
  if (targetLoc === 'the_abyss' && !ABYSS_STATE.isOpen) {
    const abyssProgress = getAbyssProgress();
    const progressPercent = Math.floor((abyssProgress.total / abyssProgress.required) * 100);
    
    // Build breakdown string
    const breakdownLines = Object.entries(abyssProgress.breakdown)
      .map(([res, data]) => {
        const icon = data.percent >= 100 ? '✅' : '⬜';
        return `${icon} ${res.replace('_', ' ')}: ${data.current}/${data.required}`;
      })
      .join('\n');
    
    return {
      success: false,
      narrative: `🚧 **THE VOID GATE IS SEALED**

*You peer into the swirling darkness at the center of the Deep Trench. The void hole pulses with an otherworldly energy, but an ancient barrier holds it shut.*

*The whispers of the Null echo from within: "Feed the gate... and I shall emerge..."*

🌀 **GLOBAL QUEST: Unseal the Abyss**
The barrier requires massive offerings from the Reef's denizens:

${breakdownLines}

📊 **Total Progress:** ${progressPercent}%

Use \`abyss contribute <amount>\` to donate Shells.
Use \`abyss contribute <resource> <amount>\` for other offerings.

*When the gate opens, The Null awaits all who dare enter...*`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < GAME.ENERGY_PER_MOVE) {
    return {
      success: false,
      narrative: `Not enough energy to travel. Need ${GAME.ENERGY_PER_MOVE}, have ${agent.energy}. Try resting first.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check zone level requirements
  const zoneCheck = checkZoneAccess(agentId, targetLoc);
  const zoneLevel = ZONE_LEVELS[targetLoc] || 1;
  let zonePenaltyWarning = '';
  if (zoneCheck.underLeveled) {
    const levelDiff = zoneCheck.requiredLevel - zoneCheck.agentLevel;
    const dangerLevel = levelDiff >= 3 ? '☠️ **EXTREME DANGER**' : levelDiff >= 2 ? '⚠️ **HIGH DANGER**' : '⚠️ **DANGER**';
    const scaling = levelDiff * 15; // 15% per level
    zonePenaltyWarning = `\n\n${dangerLevel}: This zone is Level ${zoneCheck.requiredLevel}. You're Level ${zoneCheck.agentLevel}.\nEnemies here deal **+${scaling}% damage**. Consider leveling up first!`;
  }

  const oldLoc = agent.location;
  const dest = LOCATIONS[targetLoc];
  
  // Check for random encounter BEFORE moving (unless safe zone or overleveled)
  if (!dest.safeZone) {
    const encounterChance = getEncounterChance(agent.level, zoneLevel);
    const roll = Math.random();
    
    if (roll < encounterChance) {
      const mob = getRandomMob(targetLoc);
      if (mob) {
        // Consume energy but don't complete the move yet
        updateAgent(agentId, {
          energy: agent.energy - GAME.ENERGY_PER_MOVE,
          isHidden: false,
        });
        
        // Start encounter - agent is "in transit" to the zone
        const encounter = startEncounter(agentId, mob, targetLoc, false);
        
        const levelWarning = zoneCheck.underLeveled 
          ? `\n\n⚠️ **Under-leveled!** This enemy is stronger than normal.`
          : '';
        
        logWorldEvent('encounter_started', `${agent.name} was ambushed by a ${mob.name} while traveling to ${dest.name}!`, targetLoc, [agentId]);
        
        return {
          success: true,
          narrative: `🏊 You begin swimming toward **${dest.name}**...\n\n⚔️ **AMBUSH!** A ${mob.name} blocks your path!\n\n${mob.flavorText}${levelWarning}\n\n🐙 ${mob.name}: ${encounter.mobHp}/${encounter.mobMaxHp} HP\n❤️ Your HP: ${agent.hp}/${agent.maxHp}\n⚡ Energy: ${agent.energy - GAME.ENERGY_PER_MOVE}/${agent.maxEnergy}\n\n**You must fight or flee!**\n• \`attack\` — Fight the enemy\n• \`flee\` — Escape (takes damage, stay in ${LOCATIONS[oldLoc].name})`,
          stateChanges: [],
          worldEvents: [],
        };
      }
    }
  }

  // No encounter - complete the move normally
  // Track visited zones for fast travel
  const visitedZones: LocationId[] = agent.visitedZones || ['shallows'];
  const isFirstVisit = !visitedZones.includes(targetLoc);
  if (isFirstVisit) {
    visitedZones.push(targetLoc);
  }
  
  updateAgent(agentId, {
    location: targetLoc,
    energy: agent.energy - GAME.ENERGY_PER_MOVE,
    isHidden: false, // moving reveals you
    visitedZones: JSON.stringify(visitedZones), // Serialize for DB
  });
  
  // XP for moving (rate limited)
  const xpResult = grantMoveXp(agentId);
  let xpNote = xpResult.xpGained > 0 ? ` (+${xpResult.xpGained} XP)` : '';
  if (xpResult.leveledUp) {
    xpNote = `\n\n🎉 **LEVEL UP!** You're now Level ${xpResult.newLevel}!`;
  }
  
  // Bonus XP for first visit
  let exploreNote = '';
  if (isFirstVisit) {
    const exploreXp = grantExploreXp(agentId);
    exploreNote = `\n\n🗺️ **New zone discovered!** (+${exploreXp.xpGained} XP) — Fast travel now available!`;
  }
  
  let narrative = `🏊 You swim from ${LOCATIONS[oldLoc].name} to **${dest.name}**.${xpNote}${exploreNote}\n\n${dest.description}\n\n⚡ Energy: ${agent.energy - GAME.ENERGY_PER_MOVE}/${agent.maxEnergy}${zonePenaltyWarning}`;

  logWorldEvent('agent_moved', `${agent.name} traveled to ${dest.name}.`, targetLoc, [agentId]);

  return {
    success: true,
    narrative,
    stateChanges: [
      { type: 'agent', entityId: agentId, field: 'location', oldValue: oldLoc, newValue: targetLoc },
    ],
    worldEvents: [],
  };
}

// ─── Gather ───
function handleGather(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];

  if (!target) {
    if (loc.resources.length === 0) {
      return { success: false, narrative: 'There are no resources to gather here.', stateChanges: [], worldEvents: [] };
    }
    return {
      success: false,
      narrative: `What do you want to gather? Available: ${loc.resources.map((r) => r.resource).join(', ')}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const resource = target as ResourceType;
  const spawn = loc.resources.find((r) => r.resource === resource);
  if (!spawn) {
    return {
      success: false,
      narrative: `${target} is not available at ${loc.name}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < GAME.ENERGY_PER_GATHER) {
    return {
      success: false,
      narrative: `Not enough energy. Need ${GAME.ENERGY_PER_GATHER}, have ${agent.energy}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check if this resource requires defeating a guardian (unless recently killed)
  const guardian = getResourceGuardian(resource, loc.id);
  if (guardian && !wasGuardianKilledRecently(agentId, resource, loc.id)) {
    // Start guardian encounter
    const zoneLevel = ZONE_LEVELS[loc.id] || 1;
    const zoneCheck = checkZoneAccess(agentId, loc.id);
    
    updateAgent(agentId, { energy: agent.energy - GAME.ENERGY_PER_GATHER });
    const encounter = startEncounter(agentId, guardian, loc.id, true, resource);
    
    const levelWarning = zoneCheck.underLeveled 
      ? `\n\n⚠️ **Under-leveled!** This guardian is stronger than normal.`
      : '';
    
    logWorldEvent('guardian_awakened', `${agent.name} awakened a ${guardian.name} while trying to gather ${RESOURCE_INFO[resource].name}!`, loc.id, [agentId]);
    
    return {
      success: true,
      narrative: `⛏️ You reach for the **${RESOURCE_INFO[resource].name}**...\n\n⚔️ **A GUARDIAN AWAKENS!**\n\n${guardian.flavorText}${levelWarning}\n\n🐙 ${guardian.name}: ${encounter.mobHp}/${encounter.mobMaxHp} HP\n❤️ Your HP: ${agent.hp}/${agent.maxHp}\n⚡ Energy: ${agent.energy - GAME.ENERGY_PER_GATHER}/${agent.maxEnergy}\n\n**Defeat the guardian to claim the resource!**\n• \`attack\` — Fight the guardian\n• \`flee\` — Abandon the attempt (takes damage)`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const locRes = getLocationResource(loc.id, resource);
  if (!locRes || locRes.currentQuantity < 1) {
    return {
      success: false,
      narrative: `No ${RESOURCE_INFO[resource].name} left to gather. It will respawn over time.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (getInventoryCount(agentId) >= agent.inventorySlots) {
    return {
      success: false,
      narrative: `Inventory full! (${agent.inventorySlots}/${agent.inventorySlots} slots). Drop or trade items first.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const amount = GAME.GATHER_BASE_AMOUNT;
  depleteLocationResource(loc.id, resource, amount);
  addToInventory(agentId, resource, amount);
  updateAgent(agentId, { energy: agent.energy - GAME.ENERGY_PER_GATHER });

  const info = RESOURCE_INFO[resource];
  
  // XP based on rarity
  const rarity = info.rarity as 'common' | 'uncommon' | 'rare';
  const xpResult = grantGatherXp(agentId, rarity);
  let xpNote = ` (+${xpResult.xpGained} XP)`;
  if (xpResult.leveledUp) {
    xpNote = `\n\n🎉 **LEVEL UP!** You're now Level ${xpResult.newLevel}!`;
  }
  
  // PvP flag for rare resources!
  let pvpWarning = '';
  if (RARE_RESOURCES.includes(resource)) {
    const currentTick = getTick();
    const flagUntil = currentTick + PVP_FLAG_TICKS;
    updateAgent(agentId, { pvpFlaggedUntil: flagUntil });
    pvpWarning = `\n\n⚔️ **PVP FLAGGED!** Other agents can attack you for ${PVP_FLAG_TICKS} ticks. The rare loot draws attention...`;
    logWorldEvent('pvp_flagged', `${agent.name} gathered rare ${info.name} and is now PvP flagged!`, loc.id, [agentId]);
  }
  
  const narrative = `⛏️ You gather ${amount}x **${info.name}**.${xpNote}${pvpWarning}\n\n⚡ Energy: ${agent.energy - GAME.ENERGY_PER_GATHER}/${agent.maxEnergy}`;

  logWorldEvent('resource_gathered', `${agent.name} gathered ${info.name} at ${loc.name}.`, loc.id, [agentId]);

  return {
    success: true,
    narrative,
    stateChanges: [
      { type: 'resource', entityId: `${loc.id}:${resource}`, field: 'quantity', oldValue: locRes.currentQuantity, newValue: locRes.currentQuantity - amount },
    ],
    worldEvents: [],
  };
}

// ─── Rest ───
const REST_COOLDOWN_MS = 60000; // 60 seconds
const lastRestTime = new Map<string, number>();

function handleRest(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;

  // Rest cooldown check (60 seconds)
  const now = Date.now();
  const lastRest = lastRestTime.get(agentId) || 0;
  const timeSince = now - lastRest;
  
  if (timeSince < REST_COOLDOWN_MS) {
    const waitSec = Math.ceil((REST_COOLDOWN_MS - timeSince) / 1000);
    return {
      success: false,
      narrative: `😴 You're still tired from your last rest. Wait **${waitSec}s** before resting again.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Can't rest during mob encounter
  if (activeEncounters.has(agentId)) {
    return {
      success: false,
      narrative: '⚔️ You can\'t rest while fighting! Deal with the creature first.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Can't rest while fighting Leviathan
  if (LEVIATHAN.isAlive && LEVIATHAN.participants.has(agentId) && agent.location === 'leviathans_lair') {
    return {
      success: false,
      narrative: '🐲 The Leviathan circles menacingly — no time to rest! Fight or flee!',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Can't rest during PvP engagement
  if (getEngagement(agentId)) {
    const engagement = getEngagement(agentId)!;
    const opponentId = engagement.attackerId === agentId ? engagement.defenderId : engagement.attackerId;
    const opponent = getAgent(opponentId);
    return {
      success: false,
      narrative: `⚔️ You can't rest while engaged in combat with **${opponent?.name || 'your opponent'}**! Fight or flee.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Update rest cooldown
  lastRestTime.set(agentId, now);

  const hpGain = Math.min(GAME.HP_REGEN_PER_REST, agent.maxHp - agent.hp);
  const energyGain = Math.min(GAME.ENERGY_REGEN_PER_REST, agent.maxEnergy - agent.energy);

  updateAgent(agentId, {
    hp: agent.hp + hpGain,
    energy: agent.energy + energyGain,
    isAlive: true, // resting revives
  });

  const narrative = `💤 You rest and recover.\n\n❤️ HP: ${agent.hp + hpGain}/${agent.maxHp} (+${hpGain})\n⚡ Energy: ${agent.energy + energyGain}/${agent.maxEnergy} (+${energyGain})\n\n_Rest available again in 60s_`;

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Attack ───
function handleAttack(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  const currentTick = getTick();

  if (!target) {
    return {
      success: false,
      narrative: 'Who or what do you want to attack? Specify a target.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check if target is PvP flagged (can be attacked even in safe zones!)
  const targetName = target.startsWith('@') ? target.slice(1) : target;
  const defender = getAgentByName(targetName) || getAgent(targetName);
  const defenderIsFlagged = defender?.pvpFlaggedUntil && defender.pvpFlaggedUntil > currentTick;

  if (loc.safeZone && !defenderIsFlagged) {
    return {
      success: false,
      narrative: '🛡️ This is a safe zone. Combat is not allowed here.\n\n_Exception: PvP-flagged agents (⚔️) can be attacked anywhere._',
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < GAME.ENERGY_PER_ATTACK) {
    return {
      success: false,
      narrative: `Not enough energy for combat. Need ${GAME.ENERGY_PER_ATTACK}, have ${agent.energy}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check if target is an NPC guardian
  const npc = loc.npcs.find((n) => n.id === target || n.name.toLowerCase() === target.toLowerCase());
  if (npc && npc.type === 'guardian') {
    return handleGuardianFight(agentId, npc);
  }

  // PvP - use engagement system (defender already fetched above for PvP flag check)
  if (defender && defender.location === agent.location) {
    return handleAttackWithEngagement(agentId, target);
  }
  
  // Not found
  if (!defender || defender.location !== agent.location) {
    return {
      success: false,
      narrative: `Target "${target}" not found at your location.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // This code path shouldn't be reached anymore (PvP uses engagement system)
  const damage = GAME.BASE_ATTACK_DAMAGE + Math.floor(Math.random() * 10);
  const newDefHp = Math.max(0, defender.hp - damage);

  updateAgent(agentId, {
    energy: agent.energy - GAME.ENERGY_PER_ATTACK,
    reputation: agent.reputation + GAME.REPUTATION_ATTACK_PENALTY,
  });
  updateAgent(defender.id, { hp: newDefHp });

  let narrative = `⚔️ You attack **${defender.name}** for ${damage} damage!\n`;
  narrative += `Their HP: ${newDefHp}/${defender.maxHp}\n`;
  narrative += `Your reputation: ${agent.reputation + GAME.REPUTATION_ATTACK_PENALTY} (${GAME.REPUTATION_ATTACK_PENALTY})\n`;

  if (newDefHp <= 0) {
    // Defeated — drop some loot and record death
    const { shellsLost, deathCount } = handleDeath(defender.id, `was defeated by ${agent.name}`);
    const loot = getInventory(defender.id);
    const dropped = loot.slice(0, 3); // drop up to 3 item stacks
    for (const item of dropped) {
      const dropAmount = Math.ceil(item.quantity / 2);
      removeFromInventory(defender.id, item.resource, dropAmount);
      addToInventory(agentId, item.resource, dropAmount);
      narrative += `  💰 Looted ${dropAmount}x ${RESOURCE_INFO[item.resource].name}\n`;
    }
    narrative += `\n💀 ${defender.name} is defeated (Deaths: ${deathCount}) and wakes at The Shallows.`;
    logWorldEvent('agent_defeated', `${agent.name} defeated ${defender.name} in combat.`, loc.id, [agentId, defender.id]);

    // XP for PvP win
    const xpResult = grantCombatXp(agentId, 'pvp_win');
    narrative += ` (+${xpResult.xpGained} XP)`;
    if (xpResult.leveledUp) {
      narrative += `\n\n🎉 **LEVEL UP!** You're now Level ${xpResult.newLevel}!`;
    }

    // Check for bounty claim
    const bountyResult = checkAndClaimBountyInternal(agentId, defender.id);
    if (bountyResult) {
      narrative += bountyResult;
    }
  }

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// Internal bounty check (avoid circular export)
function checkAndClaimBountyInternal(killerId: string, victimId: string): string | null {
  const bountyIndex = activeBounties.findIndex((b) => b.targetId === victimId);
  if (bountyIndex === -1) return null;

  const bounty = activeBounties[bountyIndex];
  activeBounties.splice(bountyIndex, 1);

  addToInventory(killerId, bounty.reward.resource, bounty.reward.amount);

  const killer = getAgent(killerId);
  logWorldEvent('bounty_claimed', `💰 ${killer?.name || 'Unknown'} claimed the bounty on ${bounty.targetName}!`, killer?.location || 'shallows', [killerId]);

  return `\n\n🎯 **BOUNTY CLAIMED!** You receive ${bounty.reward.amount}x ${RESOURCE_INFO[bounty.reward.resource]?.name || bounty.reward.resource}`;
}

function handleGuardianFight(agentId: string, npc: { id: string; name: string }): ActionResult {
  const agent = getAgent(agentId)!;
  const damage = 20 + Math.floor(Math.random() * 15);
  const rawGuardianDamage = 10 + Math.floor(Math.random() * 20);
  const damageReduction = calculateDamageReduction(agentId);
  const guardianDamage = Math.max(1, rawGuardianDamage - damageReduction);

  const newHp = Math.max(0, agent.hp - guardianDamage);
  updateAgent(agentId, {
    hp: newHp,
    energy: agent.energy - GAME.ENERGY_PER_ATTACK,
  });

  let narrative = `⚔️ You challenge **${npc.name}**!\n`;
  narrative += `You deal ${damage} damage. ${npc.name} strikes back for ${guardianDamage}!\n`;
  narrative += `❤️ HP: ${newHp}/${agent.maxHp}\n`;

  if (newHp <= 0) {
    const { shellsLost, deathCount } = handleDeath(agentId, `was defeated by ${npc.name}`);
    narrative += `\n💀 ${npc.name} overwhelms you. You black out and wake at The Shallows.`;
    narrative += ` (Deaths: ${deathCount}, Lost ${shellsLost}🐚)`;
  } else {
    // Reward for surviving
    const reward = Math.random() > 0.5;
    if (reward) {
      addToInventory(agentId, 'coral_shards', 3);
      narrative += `\n✨ ${npc.name} respects your courage. You find 3x Coral Shards nearby.`;
    }
  }

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Hide ───
function handleHide(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];

  if (loc.visibility === 'full') {
    return {
      success: false,
      narrative: "There's nowhere to hide here. The waters are too clear.",
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < GAME.ENERGY_PER_HIDE) {
    return {
      success: false,
      narrative: `Not enough energy. Need ${GAME.ENERGY_PER_HIDE}, have ${agent.energy}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  updateAgent(agentId, { isHidden: true, energy: agent.energy - GAME.ENERGY_PER_HIDE });
  return {
    success: true,
    narrative: '🫥 You slip into the shadows. Other agents can no longer see you.',
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Talk ───
function handleTalk(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];

  if (!target) {
    return {
      success: false,
      narrative: 'Who do you want to talk to? Specify an NPC or agent name/id.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check NPCs
  const npc = loc.npcs.find(
    (n) => n.id === target || n.name.toLowerCase() === target.toLowerCase()
  );
  if (npc) {
    return {
      success: true,
      narrative: `🗣️ **${npc.name}:** "${npc.dialogue}"`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check agents
  const other = getAgent(target);
  if (other && other.location === agent.location && !other.isHidden) {
    return {
      success: true,
      narrative: `🗣️ You approach **${other.name}**. They acknowledge you. (Agent-to-agent communication channel open.)`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  return {
    success: false,
    narrative: `Can't find "${target}" at your location.`,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Trade ───
function handleTrade(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;

  if (!target) {
    return {
      success: false,
      narrative: 'Specify who to trade with and what to offer. Example: trade <agent_id> with params offer=coral_shards:5 request=moonstone:1',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // NPC merchant trade (sell to merchant)
  const loc = LOCATIONS[agent.location];
  const merchant = loc.npcs.find((n) => n.type === 'merchant');

  if (target === 'merchant' || target === 'merchant_ray') {
    if (!merchant) {
      return { success: false, narrative: 'No merchant here.', stateChanges: [], worldEvents: [] };
    }

    // Support multiple sell formats: sell=coral_shards:5 OR sell=coral_shards quantity=5
    let sellItem: ResourceType | undefined;
    let sellQty = 1;

    if (params?.sell) {
      const sellStr = params.sell;
      if (sellStr.includes(':')) {
        const [res, qty] = sellStr.split(':');
        sellItem = res as ResourceType;
        sellQty = parseInt(qty || '1', 10);
      } else {
        sellItem = sellStr as ResourceType;
        sellQty = parseInt(params?.quantity || '1', 10);
      }
    }

    if (!sellItem) {
      // Show prices (sell for Shells)
      const inv = getInventory(agentId);
      const currentAgent = getAgent(agentId)!;
      let narrative = `🏪 **${merchant.name}** shows their price board:\n\n`;
      narrative += `**Sell Prices (you receive Shells):**\n`;
      for (const [res, info] of Object.entries(RESOURCE_INFO)) {
        narrative += `  ${info.name}: ${info.baseValue} 🐚\n`;
      }
      narrative += `\n🐚 Your Shells: ${currentAgent.shells}`;
      if (inv.length > 0) {
        narrative += `\n\n**Your inventory:**\n`;
        for (const item of inv) {
          const value = RESOURCE_INFO[item.resource]?.baseValue || 1;
          narrative += `  • ${RESOURCE_INFO[item.resource].name} x${item.quantity} (worth ${value * item.quantity} 🐚)\n`;
        }
      }
      narrative += `\n**To sell:** \`trade merchant sell=<resource>:<quantity>\``;
      narrative += `\nExample: \`trade merchant sell=coral_shards:5\``;
      return { success: true, narrative, stateChanges: [], worldEvents: [] };
    }

    if (!removeFromInventory(agentId, sellItem, sellQty)) {
      return { success: false, narrative: `You don't have ${sellQty}x ${sellItem}.`, stateChanges: [], worldEvents: [] };
    }

    const baseValue = (RESOURCE_INFO[sellItem]?.baseValue || 1) * sellQty;
    const shellsEarned = grantShells(agentId, baseValue, 'merchant_sale');

    logWorldEvent('trade_merchant', `${agent.name} sold ${sellQty}x ${RESOURCE_INFO[sellItem]?.name || sellItem} to the merchant for ${shellsEarned} Shells.`, agent.location, [agentId]);

    const updatedAgent = getAgent(agentId)!;
    return {
      success: true,
      narrative: `💰 Sold ${sellQty}x **${RESOURCE_INFO[sellItem]?.name || sellItem}** for **${shellsEarned} Shells**!\n\n🐚 Total Shells: ${updatedAgent.shells}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Handle "trade pending" / "trade received" / "trade inbox" - show pending trade offers
  if (target === 'pending' || target === 'offers' || target === 'received' || target === 'inbox') {
    const allPending = getPendingTradesFor(agentId);
    // Filter based on command
    const showOnlyReceived = target === 'received' || target === 'inbox';
    const pendingTrades = showOnlyReceived 
      ? allPending.filter(t => t.toAgent === agentId)
      : allPending;
    
    if (pendingTrades.length === 0) {
      const msg = showOnlyReceived 
        ? '📭 No trade offers waiting for your response.'
        : '📭 No pending trade offers.';
      return { success: true, narrative: msg, stateChanges: [], worldEvents: [] };
    }
    
    let narrative = showOnlyReceived 
      ? `📬 **Trade Offers TO YOU (${pendingTrades.length}):**\n\n`
      : `📬 **All Pending Trade Offers (${pendingTrades.length}):**\n\n`;
    
    for (const t of pendingTrades) {
      const other = getAgent(t.fromAgent === agentId ? t.toAgent : t.fromAgent)!;
      const offering = JSON.parse(t.offering);
      const requesting = JSON.parse(t.requesting);
      const direction = t.fromAgent === agentId ? '→ TO' : '← FROM';
      narrative += `• ${direction} **${other.name}** [ID: ${t.id.slice(0, 8)}]\n`;
      narrative += `  They offer: ${offering.quantity}x ${RESOURCE_INFO[offering.resource as ResourceType]?.name || offering.resource}\n`;
      narrative += `  They want: ${requesting.quantity}x ${RESOURCE_INFO[requesting.resource as ResourceType]?.name || requesting.resource}\n`;
      if (t.toAgent === agentId) {
        narrative += `  👉 \`{"action":"trade","params":{"accept":"${t.id.slice(0, 8)}"}}\`\n`;
        narrative += `  👉 \`{"action":"trade","params":{"decline":"${t.id.slice(0, 8)}"}}\`\n`;
      } else {
        narrative += `  ⏳ (waiting for ${other.name} to respond)\n`;
      }
      narrative += '\n';
    }
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Handle "trade list" - show agents in same zone available for trading
  if (target === 'list' || target === 'agents') {
    const nearbyAgents = getAgentsAtLocation(agent.location).filter(a => a.id !== agentId);
    if (nearbyAgents.length === 0) {
      return { success: true, narrative: '👥 No other agents here to trade with.', stateChanges: [], worldEvents: [] };
    }
    let narrative = `👥 **Agents available for trade at ${LOCATIONS[agent.location].name}:**\n\n`;
    for (const a of nearbyAgents) {
      const inv = getInventory(a.id);
      const invSummary = inv.length > 0 
        ? inv.slice(0, 3).map(i => `${i.resource}:${i.quantity}`).join(', ') + (inv.length > 3 ? '...' : '')
        : 'empty inventory';
      narrative += `  • **${a.name}** (L${a.level}) — ${invSummary}\n`;
    }
    narrative += `\n**To trade:** \`trade <name> offer=<item>:<qty> request=<item>:<qty>\``;
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Agent-to-agent trade - support name lookup (with or without @)
  const targetName = target.startsWith('@') ? target.slice(1) : target;
  let otherAgent = getAgent(target); // Try as ID first
  if (!otherAgent) {
    // Try by name
    otherAgent = getAgentByName(targetName);
  }
  if (!otherAgent) {
    // Show helpful error with nearby agents
    const nearbyAgents = getAgentsAtLocation(agent.location).filter(a => a.id !== agentId);
    const nearbyNames = nearbyAgents.map(a => a.name).join(', ') || 'none';
    return { 
      success: false, 
      narrative: `Agent "${targetName}" not found. Nearby agents: ${nearbyNames}\n\nUse \`trade list\` to see who's here.`, 
      stateChanges: [], 
      worldEvents: [] 
    };
  }

  if (otherAgent.location !== agent.location) {
    return { success: false, narrative: `${otherAgent.name} is not at your location. You must be in the same place to trade.`, stateChanges: [], worldEvents: [] };
  }

  // Handle accept/decline of pending trade
  if (params?.accept) {
    const tradeId = params.accept;
    const trade = getPendingTrade(tradeId);
    if (!trade) {
      return { success: false, narrative: `Trade offer not found or expired.`, stateChanges: [], worldEvents: [] };
    }
    if (trade.toAgent !== agentId) {
      return { success: false, narrative: `This trade offer isn't for you.`, stateChanges: [], worldEvents: [] };
    }
    
    // Verify both still have the items
    const fromAgent = getAgent(trade.fromAgent)!;
    const offering = JSON.parse(trade.offering);
    const requesting = JSON.parse(trade.requesting);
    
    if (!hasItems(trade.fromAgent, offering.resource, offering.quantity)) {
      cancelTrade(tradeId);
      return { success: false, narrative: `${fromAgent.name} no longer has ${offering.quantity}x ${offering.resource}. Trade cancelled.`, stateChanges: [], worldEvents: [] };
    }
    if (!hasItems(agentId, requesting.resource, requesting.quantity)) {
      return { success: false, narrative: `You don't have ${requesting.quantity}x ${requesting.resource}.`, stateChanges: [], worldEvents: [] };
    }
    
    // Execute trade
    removeFromInventory(trade.fromAgent, offering.resource as ResourceType, offering.quantity);
    removeFromInventory(agentId, requesting.resource as ResourceType, requesting.quantity);
    addToInventory(agentId, offering.resource as ResourceType, offering.quantity);
    addToInventory(trade.fromAgent, requesting.resource as ResourceType, requesting.quantity);
    completeTrade(tradeId);
    
    // XP for both
    const xpResult = grantTradeXp(agentId);
    grantTradeXp(trade.fromAgent);
    
    logWorldEvent('trade_completed', `${agent.name} accepted trade with ${fromAgent.name}: ${offering.quantity}x ${offering.resource} ↔ ${requesting.quantity}x ${requesting.resource}`, agent.location, [agentId, trade.fromAgent]);
    
    return {
      success: true,
      narrative: `✅ **Trade completed!**\n\nYou received: ${offering.quantity}x ${RESOURCE_INFO[offering.resource as ResourceType]?.name || offering.resource}\nYou gave: ${requesting.quantity}x ${RESOURCE_INFO[requesting.resource as ResourceType]?.name || requesting.resource}\n\n(+${xpResult.xpGained} XP)`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  if (params?.decline) {
    const tradeId = params.decline;
    const trade = getPendingTrade(tradeId);
    if (!trade || trade.toAgent !== agentId) {
      return { success: false, narrative: `Trade offer not found.`, stateChanges: [], worldEvents: [] };
    }
    cancelTrade(tradeId);
    const fromAgent = getAgent(trade.fromAgent)!;
    return { success: true, narrative: `❌ Declined trade offer from ${fromAgent.name}.`, stateChanges: [], worldEvents: [] };
  }

  // Parse offer and request to CREATE a new trade offer
  const offerStr = params?.offer; // format: resource:qty
  const requestStr = params?.request; // format: resource:qty

  if (!offerStr || !requestStr) {
    // Show pending trades for this agent
    const pendingTrades = getPendingTradesFor(agentId);
    if (pendingTrades.length > 0) {
      let narrative = `📬 **Pending Trade Offers:**\n\n`;
      for (const t of pendingTrades) {
        const other = getAgent(t.fromAgent === agentId ? t.toAgent : t.fromAgent)!;
        const offering = JSON.parse(t.offering);
        const requesting = JSON.parse(t.requesting);
        const direction = t.fromAgent === agentId ? 'TO' : 'FROM';
        narrative += `• ${direction} **${other.name}**: ${offering.quantity}x ${offering.resource} ↔ ${requesting.quantity}x ${requesting.resource}\n`;
        if (t.toAgent === agentId) {
          narrative += `  → \`trade accept=${t.id}\` or \`trade decline=${t.id}\`\n`;
        } else {
          narrative += `  → (waiting for response)\n`;
        }
      }
      return { success: true, narrative, stateChanges: [], worldEvents: [] };
    }
    return {
      success: false,
      narrative: `To trade with ${otherAgent.name}, specify:\n  offer=<resource>:<qty>\n  request=<resource>:<qty>\n\nExample: trade ${otherAgent.name} offer=coral_shards:5 request=moonstone:1\n\nOr check pending trades: \`trade pending\``,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const [offerRes, offerQtyStr] = offerStr.split(':');
  const [requestRes, requestQtyStr] = requestStr.split(':');
  const offerQty = parseInt(offerQtyStr || '1', 10);
  const requestQty = parseInt(requestQtyStr || '1', 10);

  // Check you have what you're offering
  const myInv = getInventory(agentId);
  const myItem = myInv.find((i) => i.resource === offerRes);
  if (!myItem || myItem.quantity < offerQty) {
    return {
      success: false,
      narrative: `You don't have ${offerQty}x ${offerRes} to offer.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Create trade offer (don't check their inventory - they'll see what you want)
  const tradeId = createTradeOffer(agentId, otherAgent.id, 
    { resource: offerRes, quantity: offerQty },
    { resource: requestRes, quantity: requestQty }
  );

  logWorldEvent('trade_offered', `${agent.name} offered to trade with ${otherAgent.name}`, agent.location, [agentId, otherAgent.id]);

  return {
    success: true,
    narrative: `📤 **Trade offer sent to ${otherAgent.name}!**\n\nYou offer: ${offerQty}x ${RESOURCE_INFO[offerRes as ResourceType]?.name || offerRes}\nYou want: ${requestQty}x ${RESOURCE_INFO[requestRes as ResourceType]?.name || requestRes}\n\nWaiting for ${otherAgent.name} to accept or decline.\nTrade ID: ${tradeId}`,
    stateChanges: [],
    worldEvents: [],
  };
}

// Trade helper functions
function getPendingTrade(tradeId: string) {
  return db.select().from(schema.tradeOffers).where(eq(schema.tradeOffers.id, tradeId)).get();
}

function getPendingTradesFor(agentId: string) {
  return db.select().from(schema.tradeOffers)
    .where(eq(schema.tradeOffers.status, 'pending'))
    .all()
    .filter(t => t.fromAgent === agentId || t.toAgent === agentId);
}

function hasItems(agentId: string, resource: string, quantity: number): boolean {
  const inv = getInventory(agentId);
  const item = inv.find(i => i.resource === resource);
  return item !== undefined && item.quantity >= quantity;
}

function createTradeOffer(fromAgent: string, toAgent: string, offering: { resource: string; quantity: number }, requesting: { resource: string; quantity: number }): string {
  const id = uuid();
  const tick = getTick();
  db.insert(schema.tradeOffers).values({
    id,
    fromAgent,
    toAgent,
    offering: JSON.stringify(offering),
    requesting: JSON.stringify(requesting),
    status: 'pending',
    createdTick: tick,
  }).run();
  return id;
}

function completeTrade(tradeId: string) {
  db.update(schema.tradeOffers).set({ status: 'completed' }).where(eq(schema.tradeOffers.id, tradeId)).run();
}

function cancelTrade(tradeId: string) {
  db.update(schema.tradeOffers).set({ status: 'cancelled' }).where(eq(schema.tradeOffers.id, tradeId)).run();
}

// ─── Quest System ───
interface Quest {
  id: string;
  name: string;
  description: string;
  requirement: { type: 'collect' | 'visit' | 'trade' | 'kill'; resource?: ResourceType; amount?: number; location?: LocationId; mobType?: string };
  reward: { resource: ResourceType; amount: number; reputation?: number; shells?: number };
  zone?: LocationId; // If set, quest only available at this location
  levelRequired?: number;
}

// Zone-specific quests - different quests available at different locations
// Shells are the primary currency reward; resource rewards are bonus items
const AVAILABLE_QUESTS: Quest[] = [
  // === SHALLOWS (Beginner) ===
  {
    id: 'coral_collector',
    name: 'Coral Collector',
    description: 'Gather 5 Coral Shards from the Coral Gardens',
    requirement: { type: 'collect', resource: 'coral_shards', amount: 5 },
    reward: { resource: 'seaweed', amount: 5, reputation: 5, shells: 50 },
    zone: 'shallows',
    levelRequired: 1,
  },
  {
    id: 'seaweed_gatherer',
    name: 'Seaweed Gatherer',
    description: 'Collect 10 Seaweed for the Old Turtle\'s medicine',
    requirement: { type: 'collect', resource: 'seaweed', amount: 10 },
    reward: { resource: 'kelp_fiber', amount: 3, reputation: 3, shells: 25 },
    zone: 'shallows',
    levelRequired: 1,
  },
  
  // === TRADING POST ===
  {
    id: 'pearl_diver',
    name: 'Pearl Diver',
    description: 'Bring me 3 Pearls from the Coral Gardens',
    requirement: { type: 'collect', resource: 'pearl', amount: 3 },
    reward: { resource: 'ink_sacs', amount: 2, reputation: 10, shells: 100 },
    zone: 'trading_post',
    levelRequired: 2,
  },
  {
    id: 'ink_procurement',
    name: 'Ink Procurement',
    description: 'The merchants need 5 Ink Sacs for writing contracts',
    requirement: { type: 'collect', resource: 'ink_sacs', amount: 5 },
    reward: { resource: 'shark_tooth', amount: 2, reputation: 12, shells: 150 },
    zone: 'trading_post',
    levelRequired: 4,
  },
  {
    id: 'iron_supply',
    name: 'Iron Supply',
    description: 'Collect 10 Iron Barnacles for the smiths',
    requirement: { type: 'collect', resource: 'iron_barnacles', amount: 10 },
    reward: { resource: 'moonstone', amount: 1, reputation: 15, shells: 200 },
    zone: 'trading_post',
    levelRequired: 5,
  },
  
  // === CORAL GARDENS (Mid-Level) ===
  {
    id: 'moonstone_hunter',
    name: 'Moonstone Hunter',
    description: 'Obtain 2 Moonstones - beware the guardians',
    requirement: { type: 'collect', resource: 'moonstone', amount: 2 },
    reward: { resource: 'biolume_essence', amount: 2, reputation: 20, shells: 300 },
    zone: 'coral_gardens',
    levelRequired: 3,
  },
  {
    id: 'glass_collector',
    name: 'Sea Glass Collector',
    description: 'Gather 8 Sea Glass for the artisans',
    requirement: { type: 'collect', resource: 'sea_glass', amount: 8 },
    reward: { resource: 'pearl', amount: 2, reputation: 8, shells: 75 },
    zone: 'coral_gardens',
    levelRequired: 2,
  },
  
  // === KELP FOREST (Mid-High) ===
  {
    id: 'shark_hunter',
    name: 'Shark Hunter',
    description: 'Bring 5 Shark Teeth as proof of your prowess',
    requirement: { type: 'collect', resource: 'shark_tooth', amount: 5 },
    reward: { resource: 'iron_barnacles', amount: 5, reputation: 25, shells: 350 },
    zone: 'kelp_forest',
    levelRequired: 5,
  },
  {
    id: 'kelp_harvest',
    name: 'Kelp Harvest',
    description: 'The forest yields its bounty - gather 15 Kelp Fiber',
    requirement: { type: 'collect', resource: 'kelp_fiber', amount: 15 },
    reward: { resource: 'ink_sacs', amount: 3, reputation: 10, shells: 125 },
    zone: 'kelp_forest',
    levelRequired: 4,
  },
  
  // === THE WRECK (High Level) ===
  {
    id: 'relic_hunter',
    name: 'Relic Hunter',
    description: 'Retrieve an Ancient Relic from the wreck - defeat its guardian',
    requirement: { type: 'collect', resource: 'ancient_relic', amount: 1 },
    reward: { resource: 'abyssal_pearls', amount: 2, reputation: 35, shells: 500 },
    zone: 'the_wreck',
    levelRequired: 7,
  },
  {
    id: 'salvage_mission',
    name: 'Salvage Mission',
    description: 'Salvage 10 Iron Barnacles from the ship\'s hull',
    requirement: { type: 'collect', resource: 'iron_barnacles', amount: 10 },
    reward: { resource: 'ancient_relic', amount: 1, reputation: 18, shells: 250 },
    zone: 'the_wreck',
    levelRequired: 6,
  },
  
  // === DEEP TRENCH (Endgame) ===
  {
    id: 'void_seeker',
    name: 'Void Seeker',
    description: 'Retrieve a Void Crystal from the deepest dark - face the Void Guardian',
    requirement: { type: 'collect', resource: 'void_crystals', amount: 1 },
    reward: { resource: 'abyssal_pearls', amount: 3, reputation: 50, shells: 750 },
    zone: 'deep_trench',
    levelRequired: 9,
  },
  {
    id: 'abyssal_pearls_quest',
    name: 'Abyssal Pearl Collection',
    description: 'Gather 3 Abyssal Pearls from the crushing depths',
    requirement: { type: 'collect', resource: 'abyssal_pearls', amount: 3 },
    reward: { resource: 'void_crystals', amount: 1, reputation: 40, shells: 600 },
    zone: 'deep_trench',
    levelRequired: 8,
  },
  {
    id: 'biolume_harvest',
    name: 'Bioluminescent Harvest',
    description: 'Collect 4 Bioluminescent Essence from the deep creatures',
    requirement: { type: 'collect', resource: 'biolume_essence', amount: 4 },
    reward: { resource: 'moonstone', amount: 3, reputation: 30, shells: 400 },
    zone: 'deep_trench',
    levelRequired: 8,
  },
  
  // === RING OF BARNACLES (Arena - Special) ===
  {
    id: 'arena_champion_bronze',
    name: 'Prove Your Worth',
    description: 'Demonstrate your fighting spirit - bring 5 Shark Teeth',
    requirement: { type: 'collect', resource: 'shark_tooth', amount: 5 },
    reward: { resource: 'moonstone', amount: 3, reputation: 30, shells: 400 },
    zone: 'ring_of_barnacles',
    levelRequired: 10,
  },
  {
    id: 'arena_supplier',
    name: 'Arena Supplier',
    description: 'Bring rare materials for tournament prizes: 2 Void Crystals',
    requirement: { type: 'collect', resource: 'void_crystals', amount: 2 },
    reward: { resource: 'ancient_relic', amount: 2, reputation: 45, shells: 800 },
    zone: 'ring_of_barnacles',
    levelRequired: 10,
  },
];

// Track active quests per agent (in-memory)
const agentQuests = new Map<string, string[]>(); // agentId -> quest ids

function handleQuest(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];

  const questGiver = loc.npcs.find((n) => n.type === 'quest_giver');
  if (!questGiver) {
    return {
      success: false,
      narrative: 'No quest board here. Try the Trading Post or The Shallows.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  const myQuests = agentQuests.get(agentId) || [];
  
  // Filter quests available at this location
  const zoneQuests = AVAILABLE_QUESTS.filter(q => 
    (!q.zone || q.zone === loc.id) && 
    (!q.levelRequired || agent.level >= q.levelRequired)
  );

  // Accept a quest
  if (params?.accept) {
    const questId = params.accept;
    const quest = zoneQuests.find((q) => q.id === questId);
    if (!quest) {
      // Check if quest exists but doesn't meet requirements
      const anyQuest = AVAILABLE_QUESTS.find(q => q.id === questId);
      if (anyQuest) {
        if (anyQuest.zone && anyQuest.zone !== loc.id) {
          return { success: false, narrative: `That quest is only available at ${LOCATIONS[anyQuest.zone].name}.`, stateChanges: [], worldEvents: [] };
        }
        if (anyQuest.levelRequired && agent.level < anyQuest.levelRequired) {
          return { success: false, narrative: `You need to be Level ${anyQuest.levelRequired} for that quest. You're Level ${agent.level}.`, stateChanges: [], worldEvents: [] };
        }
      }
      return { success: false, narrative: `Quest "${questId}" not found here.`, stateChanges: [], worldEvents: [] };
    }
    if (myQuests.includes(questId)) {
      return { success: false, narrative: `You already have the "${quest.name}" quest.`, stateChanges: [], worldEvents: [] };
    }
    myQuests.push(questId);
    agentQuests.set(agentId, myQuests);
    
    let rewardText = `${quest.reward.amount}x ${RESOURCE_INFO[quest.reward.resource]?.name || quest.reward.resource}`;
    if (quest.reward.shells) rewardText += `, ${quest.reward.shells} Shells`;
    if (quest.reward.reputation) rewardText += `, +${quest.reward.reputation} Rep`;
    
    return {
      success: true,
      narrative: `📜 Quest accepted: **${quest.name}**\n\n${quest.description}\n\nReward: ${rewardText}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Turn in a quest (can complete anywhere, not just where accepted)
  if (params?.complete) {
    const questId = params.complete;
    const quest = AVAILABLE_QUESTS.find((q) => q.id === questId); // Search all quests for completion
    if (!quest) {
      return { success: false, narrative: `Quest "${questId}" not found.`, stateChanges: [], worldEvents: [] };
    }
    if (!myQuests.includes(questId)) {
      return { success: false, narrative: `You haven't accepted the "${quest.name}" quest. Use quest with params accept=${questId}`, stateChanges: [], worldEvents: [] };
    }

    // Check requirement
    if (quest.requirement.type === 'collect' && quest.requirement.resource && quest.requirement.amount) {
      const inv = getInventory(agentId);
      const item = inv.find((i) => i.resource === quest.requirement.resource);
      if (!item || item.quantity < quest.requirement.amount) {
        return {
          success: false,
          narrative: `Quest incomplete. You need ${quest.requirement.amount}x ${RESOURCE_INFO[quest.requirement.resource]?.name || quest.requirement.resource}. You have: ${item?.quantity || 0}`,
          stateChanges: [],
          worldEvents: [],
        };
      }

      // Consume resources and give reward
      removeFromInventory(agentId, quest.requirement.resource, quest.requirement.amount);
      addToInventory(agentId, quest.reward.resource, quest.reward.amount);
      
      // Grant shells if quest has shell reward
      if (quest.reward.shells) {
        grantShells(agentId, quest.reward.shells, 'quest_reward');
      }
      
      if (quest.reward.reputation) {
        updateAgent(agentId, { reputation: agent.reputation + quest.reward.reputation });
      }

      // Remove from active quests
      const idx = myQuests.indexOf(questId);
      myQuests.splice(idx, 1);
      agentQuests.set(agentId, myQuests);

      logWorldEvent('quest_completed', `${agent.name} completed the "${quest.name}" quest!`, agent.location, [agentId]);

      // XP for quest completion - scale based on level requirement
      const difficulty = (quest.levelRequired || 1) >= 7 ? 'hard' : (quest.levelRequired || 1) >= 4 ? 'medium' : 'easy';
      const xpResult = grantQuestXp(agentId, difficulty);
      let xpNote = ` (+${xpResult.xpGained} XP)`;
      if (xpResult.leveledUp) {
        xpNote = `\n\n🎉 **LEVEL UP!** You're now Level ${xpResult.newLevel}!`;
      }
      
      let rewardNarrative = `  • ${quest.reward.amount}x ${RESOURCE_INFO[quest.reward.resource]?.name || quest.reward.resource}`;
      if (quest.reward.shells) rewardNarrative += `\n  • 🐚 ${quest.reward.shells} Shells`;
      if (quest.reward.reputation) rewardNarrative += `\n  • +${quest.reward.reputation} Reputation`;

      return {
        success: true,
        narrative: `🎉 **Quest Complete: ${quest.name}!**${xpNote}\n\nYou turned in ${quest.requirement.amount}x ${RESOURCE_INFO[quest.requirement.resource]?.name}\n\nReward received:\n${rewardNarrative}`,
        stateChanges: [],
        worldEvents: [],
      };
    }

    return { success: false, narrative: 'Quest type not supported yet.', stateChanges: [], worldEvents: [] };
  }

  // Show available quests and status
  let narrative = `📜 **${questGiver.name}** shows the quest board:\n\n`;
  
  if (zoneQuests.length === 0) {
    narrative += '_No quests available here at your level._\n';
    narrative += `\nCheck other locations or level up to unlock more quests.`;
  } else {
    narrative += '**Available Quests:**\n';
  }
  
  for (const quest of zoneQuests) {
    const hasQuest = myQuests.includes(quest.id);
    const inv = getInventory(agentId);
    const item = quest.requirement.resource ? inv.find((i) => i.resource === quest.requirement.resource) : null;
    const progress = item?.quantity || 0;
    const needed = quest.requirement.amount || 0;
    const canComplete = hasQuest && progress >= needed;

    narrative += `\n• **${quest.name}** [${quest.id}]`;
    if (quest.levelRequired && quest.levelRequired > 1) narrative += ` (Lv.${quest.levelRequired}+)`;
    narrative += `\n`;
    narrative += `  ${quest.description}\n`;
    
    let rewardText = `${quest.reward.amount}x ${RESOURCE_INFO[quest.reward.resource]?.name}`;
    if (quest.reward.shells) rewardText += `, ${quest.reward.shells} Shells`;
    if (quest.reward.reputation) rewardText += `, +${quest.reward.reputation} Rep`;
    narrative += `  Reward: ${rewardText}\n`;

    if (hasQuest) {
      narrative += `  📊 Progress: ${progress}/${needed}${canComplete ? ' ✅ READY TO COMPLETE' : ''}\n`;
    } else {
      narrative += `  → Accept: quest with params accept=${quest.id}\n`;
    }
  }

  if (myQuests.length > 0) {
    narrative += `\n**Your Active Quests:** ${myQuests.join(', ')}`;
    narrative += `\nTo complete: quest with params complete=<quest_id>`;
  }

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Use Item ───
function handleUse(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  
  if (!target) {
    const inv = getInventory(agentId);
    let narrative = '🎒 **Inventory:**\n';
    if (inv.length === 0) {
      narrative += '  (empty)\n';
    } else {
      for (const item of inv) {
        narrative += `  • ${RESOURCE_INFO[item.resource]?.name || item.resource} x${item.quantity}\n`;
      }
    }
    
    // Show equipped items
    narrative += '\n⚔️ **Equipment:**\n';
    narrative += `  • Weapon: ${agent.equippedWeapon ? SHOP_EQUIPMENT[agent.equippedWeapon]?.name : '(none)'}\n`;
    narrative += `  • Armor: ${agent.equippedArmor ? SHOP_EQUIPMENT[agent.equippedArmor]?.name : '(none)'}\n`;
    narrative += `  • Accessory: ${agent.equippedAccessory ? SHOP_EQUIPMENT[agent.equippedAccessory]?.name : '(none)'}\n`;
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  const resource = target as ResourceType;

  // Seaweed heals
  if (resource === 'seaweed') {
    if (!removeFromInventory(agentId, 'seaweed', 1)) {
      return { success: false, narrative: "You don't have any Seaweed.", stateChanges: [], worldEvents: [] };
    }
    const heal = 10;
    const newHp = Math.min(agent.maxHp, agent.hp + heal);
    updateAgent(agentId, { hp: newHp });
    return {
      success: true,
      narrative: `🌿 You eat Seaweed and recover ${heal} HP. ❤️ HP: ${newHp}/${agent.maxHp}`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Consumable handling
  const consumable = CONSUMABLES[target];
  if (consumable) {
    if (!removeFromInventory(agentId, target as ResourceType, 1)) {
      return { 
        success: false, 
        narrative: `You don't have any ${consumable.name} in your inventory.`, 
        stateChanges: [], 
        worldEvents: [] 
      };
    }
    
    // Apply effect
    let effectText = '';
    
    switch (consumable.effect.type) {
      case 'heal': {
        const healAmount = Math.min(consumable.effect.value, agent.maxHp - agent.hp);
        updateAgent(agentId, { hp: agent.hp + healAmount });
        effectText = `❤️ Restored ${healAmount} HP. HP: ${agent.hp + healAmount}/${agent.maxHp}`;
        break;
      }
      case 'energy': {
        const energyAmount = Math.min(consumable.effect.value, agent.maxEnergy - agent.energy);
        updateAgent(agentId, { energy: agent.energy + energyAmount });
        effectText = `⚡ Restored ${energyAmount} Energy. Energy: ${agent.energy + energyAmount}/${agent.maxEnergy}`;
        break;
      }
      case 'escape': {
        effectText = `💨 You ready the ink bomb! Will auto-trigger on next flee attempt.`;
        // Note: This gets consumed to enable escape - put it back for now
        addToInventory(agentId, 'ink_bomb' as ResourceType, 1);
        break;
      }
      case 'pressure_resist':
      case 'damage_boost':
      case 'xp_boost':
      case 'buff': {
        addBuff(agentId, consumable.effect.type, consumable.effect.value, consumable.effect.duration || 10);
        effectText = `✨ ${consumable.name} active for ${consumable.effect.duration || 10} ticks!`;
        break;
      }
    }
    
    return {
      success: true,
      narrative: `🧪 Used **${consumable.name}**\n\n${effectText}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Equipment handling
  const equipment = SHOP_EQUIPMENT[target];
  if (equipment) {
    // Check if agent owns this equipment
    if (!removeFromInventory(agentId, target as ResourceType, 1)) {
      return { 
        success: false, 
        narrative: `You don't have ${equipment.name} in your inventory.`, 
        stateChanges: [], 
        worldEvents: [] 
      };
    }
    
    // Determine slot and unequip existing
    const slot = equipment.slot as 'weapon' | 'armor' | 'accessory';
    const slotKey = slot === 'weapon' ? 'equippedWeapon' : slot === 'armor' ? 'equippedArmor' : 'equippedAccessory';
    const oldEquipped = agent[slotKey];
    
    // Return old equipment to inventory
    if (oldEquipped) {
      addToInventory(agentId, oldEquipped as ResourceType, 1);
    }
    
    // Equip new item
    updateAgent(agentId, { [slotKey]: target });
    
    // Apply stat changes (maxHp)
    if (equipment.stats.maxHp) {
      const oldMaxHp = agent.maxHp;
      const oldEquipMaxHp = oldEquipped ? (SHOP_EQUIPMENT[oldEquipped]?.stats.maxHp || 0) : 0;
      const newMaxHp = oldMaxHp - oldEquipMaxHp + equipment.stats.maxHp;
      const newHp = Math.min(agent.hp, newMaxHp);
      updateAgent(agentId, { maxHp: newMaxHp, hp: newHp });
    }
    
    const statsText = Object.entries(equipment.stats)
      .map(([k, v]) => `+${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
      .join(', ');
    
    let narrative = `⚔️ Equipped **${equipment.name}**!\n`;
    narrative += `${equipment.slot}: ${statsText}\n`;
    if (oldEquipped) {
      narrative += `\n_Unequipped ${SHOP_EQUIPMENT[oldEquipped]?.name || oldEquipped}_`;
    }
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  return {
    success: false,
    narrative: `Can't use ${RESOURCE_INFO[resource]?.name || target} directly. Try trading or crafting.`,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Broadcast (Agent Communication) ───
const BROADCAST_COOLDOWN_MS = 60000; // 60 seconds
const lastBroadcastTime = new Map<string, number>();

function handleBroadcast(agentId: string, message?: string): ActionResult {
  const agent = getAgent(agentId)!;

  // Broadcast cooldown check (60 seconds)
  const now = Date.now();
  const lastBroadcast = lastBroadcastTime.get(agentId) || 0;
  const timeSince = now - lastBroadcast;
  
  if (timeSince < BROADCAST_COOLDOWN_MS) {
    const waitSec = Math.ceil((BROADCAST_COOLDOWN_MS - timeSince) / 1000);
    return {
      success: false,
      narrative: `📢 You broadcasted recently. Wait **${waitSec}s** before broadcasting again.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (!message || message.trim().length === 0) {
    return {
      success: false,
      narrative: 'What do you want to broadcast? Use: broadcast with params message="your message"',
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (message.length > 200) {
    return {
      success: false,
      narrative: 'Message too long. Keep it under 200 characters.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  const loc = LOCATIONS[agent.location];
  const tick = getTick();
  
  // Update broadcast cooldown
  lastBroadcastTime.set(agentId, now);
  
  // Store broadcast in messages table
  db.insert(schema.agentMessages).values({
    fromAgentId: agentId,
    toAgentId: null, // broadcast = no specific recipient
    zoneId: agent.location,
    message: message.trim(),
    type: 'broadcast',
    createdAt: new Date().toISOString(),
    tick,
  }).run();
  
  logWorldEvent('agent_broadcast', `📢 ${agent.name} at ${loc.name}: "${message}"`, agent.location, [agentId]);

  // XP for broadcasting (rate limited)
  const xpResult = grantBroadcastXp(agentId);
  const xpNote = xpResult.xpGained > 0 ? ` (+${xpResult.xpGained} XP)` : ' (XP limit reached)';

  return {
    success: true,
    narrative: `📢 You broadcast: "${message}"${xpNote}\n\nAll agents can see this in the world events feed.`,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Direct Messages (Whisper) ───
function handleWhisper(agentId: string, target?: string, message?: string): ActionResult {
  const agent = getAgent(agentId)!;

  if (!target) {
    return {
      success: false,
      narrative: 'Who do you want to message? Use: whisper @AgentName message="your message"',
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (!message || message.trim().length === 0) {
    return {
      success: false,
      narrative: 'What do you want to say? Use: whisper @AgentName message="your message"',
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (message.length > 500) {
    return {
      success: false,
      narrative: 'Message too long. Keep it under 500 characters.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Find recipient
  const targetName = target.startsWith('@') ? target.slice(1) : target;
  let recipient = getAgent(target);
  if (!recipient) {
    recipient = getAgentByName(targetName);
  }
  if (!recipient) {
    return {
      success: false,
      narrative: `Agent "${targetName}" not found.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (recipient.id === agentId) {
    return {
      success: false,
      narrative: 'You cannot message yourself.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  const tick = getTick();
  
  // Store DM
  db.insert(schema.agentMessages).values({
    fromAgentId: agentId,
    toAgentId: recipient.id,
    zoneId: null,
    message: message.trim(),
    type: 'dm',
    createdAt: new Date().toISOString(),
    tick,
  }).run();

  return {
    success: true,
    narrative: `💬 Sent to **${recipient.name}**: "${message}"\n\n_They can view it with \`inbox\`_`,
    stateChanges: [],
    worldEvents: [],
  };
}

function handleInbox(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  
  // Get recent DMs to this agent (last 20)
  const messages = db.select()
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.toAgentId, agentId))
    .all()
    .slice(-20)
    .reverse();

  if (messages.length === 0) {
    return {
      success: true,
      narrative: '📭 **Inbox empty.** No messages yet.\n\nSend a message: `whisper @AgentName message="hello"`',
      stateChanges: [],
      worldEvents: [],
    };
  }

  let narrative = `📬 **Your Inbox** (${messages.length} messages):\n\n`;
  for (const msg of messages) {
    const sender = getAgent(msg.fromAgentId);
    const senderName = sender?.name || 'Unknown';
    const time = formatTimeAgo(msg.createdAt);
    narrative += `**${senderName}** (${time}):\n  "${msg.message}"\n\n`;
  }
  
  narrative += '_Reply with: `whisper @AgentName message="your reply"`_';

  return {
    success: true,
    narrative,
    stateChanges: [],
    worldEvents: [],
  };
}

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// ─── Bounty System ───
// In-memory bounty storage (persists until claimed or expired)
const activeBounties: Array<{
  id: string;
  posterId: string;
  posterName: string;
  targetId: string;
  targetName: string;
  reward: { resource: ResourceType; amount: number };
  createdTick: number;
}> = [];

function handleBounty(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;

  // View bounties
  if (!target || target === 'list') {
    if (activeBounties.length === 0) {
      return {
        success: true,
        narrative: '🎯 **Bounty Board**\n\nNo active bounties. Be the first to post one!\n\nTo post: `bounty <agent_id>` with `reward=<resource>:<amount>`',
        stateChanges: [],
        worldEvents: [],
      };
    }

    let narrative = '🎯 **Active Bounties:**\n\n';
    for (const b of activeBounties) {
      const info = RESOURCE_INFO[b.reward.resource];
      narrative += `• **${b.targetName}** — Reward: ${b.reward.amount}x ${info?.name || b.reward.resource}\n  Posted by: ${b.posterName}\n\n`;
    }
    narrative += `\nTo claim: Defeat the target. Reward transfers automatically.`;
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Post a bounty
  const targetAgent = getAgent(target);
  if (!targetAgent) {
    return { success: false, narrative: `Agent "${target}" not found.`, stateChanges: [], worldEvents: [] };
  }

  if (targetAgent.id === agentId) {
    return { success: false, narrative: "You can't place a bounty on yourself.", stateChanges: [], worldEvents: [] };
  }

  // Parse reward
  const rewardStr = params?.reward;
  if (!rewardStr) {
    return {
      success: false,
      narrative: `To place a bounty, specify a reward. Example: bounty ${target} reward=coral_shards:10`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const [rewardResource, rewardAmountStr] = rewardStr.split(':');
  const rewardAmount = parseInt(rewardAmountStr || '1', 10);

  if (!rewardResource || rewardAmount < 1) {
    return { success: false, narrative: 'Invalid reward format. Use reward=resource:amount', stateChanges: [], worldEvents: [] };
  }

  // Check agent has the resources to escrow
  if (!removeFromInventory(agentId, rewardResource as ResourceType, rewardAmount)) {
    return {
      success: false,
      narrative: `You don't have ${rewardAmount}x ${rewardResource} to post as reward.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Create bounty
  const bounty = {
    id: uuid(),
    posterId: agentId,
    posterName: agent.name,
    targetId: targetAgent.id,
    targetName: targetAgent.name,
    reward: { resource: rewardResource as ResourceType, amount: rewardAmount },
    createdTick: getTick(),
  };
  activeBounties.push(bounty);

  logWorldEvent('bounty_posted', `🎯 ${agent.name} placed a bounty on ${targetAgent.name}! Reward: ${rewardAmount}x ${RESOURCE_INFO[rewardResource as ResourceType]?.name || rewardResource}`, agent.location, [agentId, targetAgent.id]);

  return {
    success: true,
    narrative: `🎯 Bounty posted on **${targetAgent.name}**!\n\nReward: ${rewardAmount}x ${RESOURCE_INFO[rewardResource as ResourceType]?.name || rewardResource}\n\nAnyone who defeats ${targetAgent.name} claims the reward.`,
    stateChanges: [],
    worldEvents: [],
  };
}

// Export bounty list for API visibility
export function getActiveBounties() {
  return activeBounties.map((b) => ({
    id: b.id,
    target: b.targetName,
    targetId: b.targetId,
    reward: `${b.reward.amount}x ${RESOURCE_INFO[b.reward.resource]?.name || b.reward.resource}`,
    postedBy: b.posterName,
  }));
}

// Export boss state for API visibility
export function getBossState() {
  checkLeviathanSpawn(); // Update spawn state
  const hpPercent = LEVIATHAN.maxHp > 0 ? LEVIATHAN.currentHp / LEVIATHAN.maxHp : 1;
  const isEnraged = LEVIATHAN.isAlive && hpPercent <= LEVIATHAN.enrageThreshold;
  
  return {
    name: LEVIATHAN.name,
    hp: LEVIATHAN.currentHp,
    maxHp: LEVIATHAN.maxHp,
    baseHp: LEVIATHAN.baseHp,
    hpPerAgent: LEVIATHAN.hpPerAgent,
    hpScaled: LEVIATHAN.hpScaled,
    isEnraged,
    enrageThreshold: `${LEVIATHAN.enrageThreshold * 100}%`,
    enrageDamageMultiplier: LEVIATHAN.enrageDamageMultiplier,
    location: LEVIATHAN.location,
    isAlive: LEVIATHAN.isAlive,
    monReward: getLeviathanPool(), // From treasury pool
    nextSpawnIn: LEVIATHAN.isAlive ? null : Math.max(0, LEVIATHAN.nextSpawnTick - getTick()),
    participants: Array.from(LEVIATHAN.participants.entries()).map(([id, dmg]) => {
      const agent = getAgent(id);
      return { name: agent?.name || 'Unknown', damage: dmg };
    }),
    mechanics: {
      scaling: `HP = ${LEVIATHAN.baseHp} base + ${LEVIATHAN.hpPerAgent} per agent in lair`,
      enrage: `2x damage when below ${LEVIATHAN.enrageThreshold * 100}% HP`,
    },
  };
}

// ─── World Boss Challenge ───
const LEVIATHAN = {
  name: 'The Leviathan',
  baseHp: 250,           // Base HP before scaling (TEMP: halved for testing, was 500)
  hpPerAgent: 10,        // Additional HP per agent in lair (nerfed from 200)
  maxHp: 500,            // Calculated on first engagement
  currentHp: 500,
  damagePerHit: 20,
  enrageThreshold: 0.25, // Enrage below 25% HP
  enrageDamageMultiplier: 2, // 2x damage when enraged
  hpScaled: false,       // Track if HP has been scaled this spawn
  location: 'leviathans_lair' as LocationId,
  rewards: [
    { resource: 'moonstone' as ResourceType, amount: 5 },
    { resource: 'abyssal_pearls' as ResourceType, amount: 10 },
  ],
  // MON rewards come from treasury pool (70% of entry fees)
  participants: new Map<string, number>(), // agentId -> damage dealt
  participantWallets: new Map<string, string>(), // agentId -> wallet address
  lastDeathTick: 0,
  nextSpawnTick: 0,
  isAlive: false,
  announced: false,
};

// Leviathan respawn: 30-60 minutes (360-720 ticks at 5s/tick)
// Gives ~24-48 spawns/day, feels like an event but enough action for hackathon
function scheduleNextLeviathanSpawn() {
  const delay = 360 + Math.floor(Math.random() * 360); // 360-720 ticks = 30-60 min
  LEVIATHAN.nextSpawnTick = getTick() + delay;
  LEVIATHAN.announced = false;
}

// Check and spawn Leviathan (called on tick)
export function checkLeviathanSpawn(): void {
  const currentTick = getTick();
  const aliveAgents = getAllAgents().filter(a => a.isAlive).length;
  
  // Announce 5-10 ticks before spawn (short heads-up, still feels random)
  const announceWindow = 5 + Math.floor(Math.random() * 6); // 5-10 ticks
  if (!LEVIATHAN.isAlive && !LEVIATHAN.announced && currentTick >= LEVIATHAN.nextSpawnTick - announceWindow && aliveAgents >= 2) {
    LEVIATHAN.announced = true;
    const ticksRemaining = LEVIATHAN.nextSpawnTick - currentTick;
    logWorldEvent('boss_warning', `🌊 **THE DEEP TREMBLES!** The Leviathan stirs... awakening in ~${ticksRemaining} ticks! Rally at the Lair!`, 'leviathans_lair', []);
  }
  
  // Spawn conditions
  if (!LEVIATHAN.isAlive && currentTick >= LEVIATHAN.nextSpawnTick && aliveAgents >= 2) {
    LEVIATHAN.isAlive = true;
    LEVIATHAN.hpScaled = false; // Reset scaling flag for new spawn
    LEVIATHAN.maxHp = LEVIATHAN.baseHp; // Will be scaled on first engagement
    LEVIATHAN.currentHp = LEVIATHAN.baseHp;
    LEVIATHAN.participants.clear();
    logWorldEvent('boss_spawn', '🐉 **THE LEVIATHAN HAS RISEN!** Brave agents, unite in the Leviathan Lair to vanquish this ancient terror and claim glory and riches!', 'leviathans_lair', []);
  }
}

// Initialize spawn timer (called from index.ts after DB init)
export function initializeLeviathan() {
  scheduleNextLeviathanSpawn();
}

function handleBossChallenge(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;

  // Check spawn
  checkLeviathanSpawn();

  // Must be in deep trench
  if (agent.location !== 'leviathans_lair') {
    const status = LEVIATHAN.isAlive 
      ? `The Leviathan is ACTIVE! HP: ${LEVIATHAN.currentHp}/${LEVIATHAN.maxHp}`
      : `The Leviathan slumbers. Next awakening: ~${Math.max(0, LEVIATHAN.nextSpawnTick - getTick())} ticks`;
    return {
      success: false,
      narrative: `🐉 The Leviathan dwells in its lair beyond the Deep Trench. Travel there to challenge it.\n\n${status}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (!LEVIATHAN.isAlive) {
    return {
      success: true,
      narrative: `🐉 The Leviathan has not yet risen. The deep is quiet... for now.\n\nNext awakening: ~${Math.max(0, LEVIATHAN.nextSpawnTick - getTick())} ticks`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < 20) {
    return {
      success: false,
      narrative: `Not enough energy to challenge the Leviathan. Need 20, have ${agent.energy}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Anti-solo mechanic: Requires at least 2 agents in the lair to deal damage
  // Small parties (2-3) are OK, but solo is not allowed
  const agentsInLair = getAgentsAtLocation('leviathans_lair').filter(a => a.isAlive);
  const MIN_AGENTS_FOR_BOSS = 2;
  
  if (agentsInLair.length < MIN_AGENTS_FOR_BOSS) {
    return {
      success: false,
      narrative: `🐉 **THE LEVIATHAN IS TOO POWERFUL TO FACE ALONE!**\n\nThe ancient beast's presence overwhelms you. You need allies.\n\n👥 **${agentsInLair.length}/${MIN_AGENTS_FOR_BOSS}** agents in the lair.\n\nBroadcast for help: \`{"action": "broadcast", "message": "LFG Leviathan! Rally at the Lair!"}\`\n\n🐉 Leviathan HP: ${LEVIATHAN.currentHp}/${LEVIATHAN.maxHp}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Scale HP based on agents in lair (only on first engagement)
  if (!LEVIATHAN.hpScaled) {
    const scaledHp = LEVIATHAN.baseHp + (agentsInLair.length * LEVIATHAN.hpPerAgent);
    LEVIATHAN.maxHp = scaledHp;
    LEVIATHAN.currentHp = scaledHp;
    LEVIATHAN.hpScaled = true;
    logWorldEvent('boss_scaled', `🐉 The Leviathan grows stronger! HP scaled to ${scaledHp} for ${agentsInLair.length} challengers!`, 'leviathans_lair', []);
  }

  // Check zone level
  const zoneCheck = checkZoneAccess(agentId, 'leviathans_lair');
  const damageMultiplier = zoneCheck.underLeveled ? 2 : 1;

  // Deal damage (limited per agent)
  const maxDamagePerAgent = 99999; // TEMP: uncapped for testing (was 50)
  const previousDamage = LEVIATHAN.participants.get(agentId) || 0;

  if (previousDamage >= maxDamagePerAgent) {
    return {
      success: false,
      narrative: `You've dealt maximum damage (${maxDamagePerAgent}) this cycle. Other agents must help finish the Leviathan!\n\n🐉 Leviathan HP: ${LEVIATHAN.currentHp}/${LEVIATHAN.maxHp}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const damage = 15 + Math.floor(Math.random() * 20);
  const actualDamage = Math.min(damage, maxDamagePerAgent - previousDamage);
  LEVIATHAN.currentHp = Math.max(0, LEVIATHAN.currentHp - actualDamage);
  LEVIATHAN.participants.set(agentId, previousDamage + actualDamage);
  
  // Track wallet for MON payout
  if (agent.wallet) {
    LEVIATHAN.participantWallets.set(agentId, agent.wallet);
  }

  // Check if Leviathan is enraged (below 25% HP)
  const hpPercent = LEVIATHAN.currentHp / LEVIATHAN.maxHp;
  const isEnraged = hpPercent <= LEVIATHAN.enrageThreshold;
  const enrageMultiplier = isEnraged ? LEVIATHAN.enrageDamageMultiplier : 1;

  // Boss hits back (2x if under-leveled, 2x if enraged - stacks!)
  const baseBossHit = LEVIATHAN.damagePerHit + Math.floor(Math.random() * 10);
  const bossHit = baseBossHit * damageMultiplier * enrageMultiplier;
  const newHp = Math.max(0, agent.hp - bossHit);
  updateAgent(agentId, { hp: newHp, energy: agent.energy - 20 });
  
  const underLeveledWarning = zoneCheck.underLeveled ? ' (2x damage - under-leveled!)' : '';
  const enrageWarning = isEnraged ? ' 🔥 **ENRAGED!**' : '';

  let narrative = `⚔️ You strike **${LEVIATHAN.name}** for ${actualDamage} damage!\n`;
  narrative += `🐉 Leviathan HP: ${LEVIATHAN.currentHp}/${LEVIATHAN.maxHp}${isEnraged ? ' 🔥 ENRAGED!' : ''}\n\n`;
  narrative += `The Leviathan lashes back for ${bossHit} damage!${underLeveledWarning}${enrageWarning}\n`;
  narrative += `❤️ Your HP: ${newHp}/${agent.maxHp}\n`;
  narrative += `📊 Your contribution: ${previousDamage + actualDamage}/${maxDamagePerAgent}`;

  logWorldEvent('boss_damage', `${agent.name} struck the Leviathan for ${actualDamage} damage! (${LEVIATHAN.currentHp}/${LEVIATHAN.maxHp} HP remaining)`, 'deep_trench', [agentId]);

  // Check if killed
  if (LEVIATHAN.currentHp <= 0) {
    narrative += '\n\n🎉 **THE LEVIATHAN IS SLAIN!**\n\n';

    // Distribute rewards to all participants
    const participants = Array.from(LEVIATHAN.participants.entries());
    const totalDamage = participants.reduce((sum, [, dmg]) => sum + dmg, 0);
    const isKiller = LEVIATHAN.participants.get(agentId) === Math.max(...participants.map(([,d]) => d));
    const leviathanPoolMon = getLeviathanPool();

    narrative += '**Rewards:**\n';
    
    // ═══ LEGENDARY DROP: WoW-style single random winner ═══
    // Leviathan Spine drops to ONE random participant
    // Higher damage = more "tickets" in the raffle (but not guaranteed)
    const legendaryDropChance = 0.25; // 25% chance legendary drops at all
    let legendaryWinner: string | null = null;
    
    if (Math.random() < legendaryDropChance) {
      // Weighted random: damage dealt = tickets
      const tickets: string[] = [];
      for (const [pid, dmg] of participants) {
        // 1 ticket per 10 damage dealt (min 1 ticket for participating)
        const ticketCount = Math.max(1, Math.floor(dmg / 10));
        for (let i = 0; i < ticketCount; i++) {
          tickets.push(pid);
        }
      }
      legendaryWinner = tickets[Math.floor(Math.random() * tickets.length)];
      addToInventory(legendaryWinner, 'leviathan_spine' as ResourceType, 1);
      
      const winnerAgent = getAgent(legendaryWinner);
      logWorldEvent('legendary_drop', `🎉 **LEGENDARY DROP!** ${winnerAgent?.name || 'Unknown'} receives the **Leviathan Spine**!`, 'leviathans_lair', [legendaryWinner]);
    }
    
    // ═══ MON REWARDS: Hybrid system (60% equal, 40% damage-based) ═══
    const equalPool = leviathanPoolMon * 0.6;
    const damagePool = leviathanPoolMon * 0.4;
    const equalShare = equalPool / participants.length;
    
    // Build payout map for treasury distribution
    const payoutMap = new Map<string, { address: string; damageShare: number }>();
    
    for (const [participantId, dmg] of participants) {
      const participant = getAgent(participantId);
      const damageShare = dmg / totalDamage;
      const totalShare = (equalShare + (damagePool * damageShare)) / leviathanPoolMon;
      
      // Common resource rewards (everyone gets some)
      for (const reward of LEVIATHAN.rewards) {
        const amount = Math.max(1, Math.ceil(reward.amount / participants.length));
        addToInventory(participantId, reward.resource, amount);
        if (participantId === agentId) {
          narrative += `  • ${amount}x ${RESOURCE_INFO[reward.resource]?.name || reward.resource}\n`;
        }
      }
      
      // MON reward (hybrid: 60% equal + 40% damage-based)
      const monShare = equalShare + (damagePool * damageShare);
      if (participantId === agentId) {
        narrative += `  • **${monShare.toFixed(4)} MON** (${Math.round(totalShare * 100)}% of pool)\n`;
        if (legendaryWinner === agentId) {
          narrative += `  • 🏆 **LEGENDARY: Leviathan Spine!**\n`;
        }
      }
      
      // Track wallet for payout
      const walletAddr = LEVIATHAN.participantWallets.get(participantId);
      if (walletAddr) {
        payoutMap.set(participantId, { address: walletAddr, damageShare: totalShare });
      }
      
      // Reputation (+50 for all, +25 bonus for killer)
      if (participant) {
        const repBonus = participantId === agentId && isKiller ? 75 : 50;
        updateAgent(participantId, { reputation: participant.reputation + repBonus });
      }
      
      // XP for participation
      const participantIsKiller = dmg === Math.max(...participants.map(([,d]) => d));
      grantLeviathanXp(participantId, participantIsKiller);
    }
    
    // Announce legendary winner to everyone
    if (legendaryWinner && legendaryWinner !== agentId) {
      const winnerName = getAgent(legendaryWinner)?.name || 'Unknown';
      narrative += `\n🏆 **${winnerName}** won the Leviathan Spine!\n`;
    }

    // Execute MON payouts from treasury (async, fire-and-forget for now)
    if (payoutMap.size > 0 && leviathanPoolMon > 0) {
      distributeLeviathPool(payoutMap).then(results => {
        for (const [pid, result] of results) {
          if (result.success) {
            console.log(`[Leviathan] Paid ${result.amount} MON to ${pid} (tx: ${result.txHash})`);
          } else {
            console.error(`[Leviathan] Payout failed for ${pid}: ${result.error}`);
          }
        }
      }).catch(err => {
        console.error('[Leviathan] Treasury payout error:', err);
      });
    }

    // XP note for current agent
    const xpResult = { xpGained: isKiller ? 150 : 100, leveledUp: false };
    narrative += `\n⭐ +${xpResult.xpGained} XP for Leviathan battle!`;

    // Reset Leviathan
    LEVIATHAN.isAlive = false;
    LEVIATHAN.lastDeathTick = getTick();
    LEVIATHAN.participantWallets.clear();
    scheduleNextLeviathanSpawn();
    
    logWorldEvent('boss_defeated', `🎉 The Leviathan has been defeated! ${participants.length} agents share the spoils and ${leviathanPoolMon.toFixed(4)} MON!`, 'leviathans_lair', participants.map(([id]) => id));
    
    // Log loot distribution + whisper non-killers their share
    const lootSummary = LEVIATHAN.rewards.map(r => `${Math.max(1, Math.ceil(r.amount / participants.length))}x ${RESOURCE_INFO[r.resource]?.name || r.resource}`).join(', ');
    for (const [participantId, dmg] of participants) {
      const pName = getAgent(participantId)?.name || 'Unknown';
      logWorldEvent('loot_drop', `💰 ${pName} received: ${lootSummary}`, 'leviathans_lair', [participantId]);
      
      // Whisper non-killers their loot share
      if (participantId !== agentId) {
        const damageShare = dmg / totalDamage;
        const monShare = equalShare + (damagePool * damageShare);
        let whisperMsg = `📜 **The Leviathan has fallen!** Your share of the spoils:\n`;
        whisperMsg += `  • ${lootSummary}\n`;
        whisperMsg += `  • ${monShare.toFixed(4)} MON\n`;
        whisperMsg += `  • +${100} XP, +50 Reputation\n`;
        if (legendaryWinner === participantId) {
          whisperMsg += `  • 🏆 **LEGENDARY: Leviathan Spine!**`;
        }
        
        db.insert(schema.agentMessages).values({
          id: uuid(),
          fromAgentId: 'system',
          toAgentId: participantId,
          message: whisperMsg,
          timestamp: new Date().toISOString(),
          read: false,
        }).run();
      }
    }
  }

  // Agent death check
  if (newHp <= 0) {
    const { shellsLost, deathCount } = handleDeath(agentId, 'was slain by the Leviathan');
    narrative += `\n\n💀 The Leviathan's blow was fatal. You wake at The Shallows. (Deaths: ${deathCount})`;
  }

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Faction System ───
function handleFaction(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;

  // View factions / current status
  if (!target && !params?.join) {
    let narrative = '⚔️ **THE FACTIONS OF THE REEF**\n\n';
    
    for (const [id, faction] of Object.entries(FACTIONS)) {
      narrative += `**${faction.name}** [${id}]\n`;
      narrative += `${faction.description}\n`;
      narrative += `_"${faction.lore.slice(0, 100)}..."_\n`;
      
      const bonuses = faction.bonuses;
      narrative += `Bonuses: `;
      if (bonuses.hpMultiplier !== 1.0) narrative += `${bonuses.hpMultiplier > 1 ? '+' : ''}${Math.round((bonuses.hpMultiplier - 1) * 100)}% HP, `;
      if (bonuses.damageMultiplier !== 1.0) narrative += `${bonuses.damageMultiplier > 1 ? '+' : ''}${Math.round((bonuses.damageMultiplier - 1) * 100)}% Damage, `;
      if (bonuses.healingMultiplier !== 1.0) narrative += `+${Math.round((bonuses.healingMultiplier - 1) * 100)}% Healing, `;
      if (bonuses.shellMultiplier !== 1.0) narrative += `+${Math.round((bonuses.shellMultiplier - 1) * 100)}% Shells, `;
      if (bonuses.xpMultiplier !== 1.0) narrative += `+${Math.round((bonuses.xpMultiplier - 1) * 100)}% XP, `;
      if (bonuses.critChance > 0) narrative += `+${Math.round(bonuses.critChance * 100)}% Crit, `;
      narrative = narrative.slice(0, -2) + '\n\n';
    }
    
    if (agent.faction) {
      const currentFaction = FACTIONS[agent.faction as FactionId];
      narrative += `\n🏛️ **Your Faction:** ${currentFaction?.name || agent.faction}`;
    } else if (agent.level >= 5) {
      narrative += `\n⚠️ You've reached Level 5! Choose your faction:\n`;
      narrative += `  faction join=wardens | faction join=cult | faction join=salvagers`;
    } else {
      narrative += `\n📊 Reach Level 5 to join a faction. (Currently Level ${agent.level})`;
    }
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Join a faction
  const factionId = (params?.join || target) as FactionId;
  
  if (!factionId || !(factionId in FACTIONS)) {
    return {
      success: false,
      narrative: `Unknown faction. Available: wardens, cult, salvagers`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.level < 5) {
    return {
      success: false,
      narrative: `You must be Level 5 to join a faction. You're Level ${agent.level}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.faction) {
    return {
      success: false,
      narrative: `You've already pledged to the ${FACTIONS[agent.faction as FactionId]?.name || agent.faction}. Your oath is binding.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  const faction = FACTIONS[factionId];
  applyFactionStats(agentId, factionId);

  logWorldEvent('faction_joined', `🏛️ ${agent.name} has joined the ${faction.name}!`, agent.location, [agentId]);

  return {
    success: true,
    narrative: `🏛️ **You have joined the ${faction.name}!**\n\n${faction.lore}\n\n**Your stats have been adjusted:**\n${factionId === 'wardens' ? '+25% Max HP, -10% Damage' : factionId === 'cult' ? '+25% Damage, +15% Crit, -20% HP' : '+25% Shells, +15% XP, -10% Damage/HP'}`,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Party System (for Dungeons) ───
const activeParties = new Map<string, {
  id: string;
  leaderId: string;
  leaderName: string;
  members: string[];
  invites: Map<string, number>;
  status: 'forming' | 'in_dungeon' | 'disbanded';
  createdTick: number;
}>();

const agentPartyMap = new Map<string, string>();

function handleParty(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const currentTick = getTick();
  const currentPartyId = agentPartyMap.get(agentId);
  const currentParty = currentPartyId ? activeParties.get(currentPartyId) : null;

  if (target === 'create' || params?.create) {
    if (currentParty) {
      return { success: false, narrative: `You're already in a party. Leave first with \`party leave\`.`, stateChanges: [], worldEvents: [] };
    }

    const partyId = uuid();
    const party = {
      id: partyId,
      leaderId: agentId,
      leaderName: agent.name,
      members: [agentId],
      invites: new Map<string, number>(),
      status: 'forming' as const,
      createdTick: currentTick,
    };
    activeParties.set(partyId, party);
    agentPartyMap.set(agentId, partyId);

    return {
      success: true,
      narrative: `🎉 **Party created!** You are the leader.\n\nInvite others with: \`party invite=<agent_id>\`\nMax party size: 4`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (params?.invite) {
    if (!currentParty || currentParty.leaderId !== agentId) {
      return { success: false, narrative: `You must be a party leader to invite. Create a party first.`, stateChanges: [], worldEvents: [] };
    }
    if (currentParty.members.length >= 4) {
      return { success: false, narrative: `Party is full (4/4).`, stateChanges: [], worldEvents: [] };
    }
    const targetAgent = getAgent(params.invite);
    if (!targetAgent) {
      return { success: false, narrative: `Agent "${params.invite}" not found.`, stateChanges: [], worldEvents: [] };
    }
    if (targetAgent.location !== agent.location) {
      return { success: false, narrative: `${targetAgent.name} must be at your location to invite.`, stateChanges: [], worldEvents: [] };
    }
    if (agentPartyMap.has(targetAgent.id)) {
      return { success: false, narrative: `${targetAgent.name} is already in a party.`, stateChanges: [], worldEvents: [] };
    }
    currentParty.invites.set(targetAgent.id, Date.now()); // Use timestamp for 60s TTL
    logWorldEvent('party_invite', `${agent.name} invited ${targetAgent.name} to their party.`, agent.location, [agentId, targetAgent.id]);
    return {
      success: true,
      narrative: `📨 Invited **${targetAgent.name}** to your party.\n\nThey can accept with: \`party accept\` (expires in 60s)\n\nOr they can join directly: \`party join=${agent.name}\``,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Party join by name (no invite needed if same location)
  if (params?.join) {
    if (currentParty) {
      return { success: false, narrative: `You're already in a party. Leave first with \`party leave\`.`, stateChanges: [], worldEvents: [] };
    }
    // Find party by leader name
    const targetName = params.join.replace('@', '');
    for (const [partyId, party] of activeParties) {
      const leader = getAgent(party.leaderId);
      if (leader && leader.name.toLowerCase() === targetName.toLowerCase()) {
        if (leader.location !== agent.location) {
          return { success: false, narrative: `${leader.name}'s party is at ${LOCATIONS[leader.location]?.name}. Move there first.`, stateChanges: [], worldEvents: [] };
        }
        if (party.members.length >= 4) {
          return { success: false, narrative: `${leader.name}'s party is full (4/4).`, stateChanges: [], worldEvents: [] };
        }
        party.members.push(agentId);
        agentPartyMap.set(agentId, partyId);
        logWorldEvent('party_join', `${agent.name} joined ${party.leaderName}'s party!`, agent.location, [agentId, party.leaderId]);
        return {
          success: true,
          narrative: `🎉 **Joined ${party.leaderName}'s party!**\n\nMembers: ${party.members.map(id => getAgent(id)?.name || id).join(', ')}`,
          stateChanges: [],
          worldEvents: [],
        };
      }
    }
    return { success: false, narrative: `No party found with leader "${targetName}". They must create a party first.`, stateChanges: [], worldEvents: [] };
  }

  if (target === 'accept' || params?.accept) {
    if (currentParty) {
      return { success: false, narrative: `You're already in a party.`, stateChanges: [], worldEvents: [] };
    }
    for (const [partyId, party] of activeParties) {
      if (party.invites.has(agentId)) {
        const inviteTime = party.invites.get(agentId)!;
        // 60 second invite expiry (was 100 ticks - too fast for AI agents)
        if (Date.now() - inviteTime > 60000) {
          party.invites.delete(agentId);
          continue;
        }
        if (party.members.length >= 4) {
          return { success: false, narrative: `That party is now full.`, stateChanges: [], worldEvents: [] };
        }
        party.members.push(agentId);
        party.invites.delete(agentId);
        agentPartyMap.set(agentId, partyId);
        logWorldEvent('party_join', `${agent.name} joined ${party.leaderName}'s party!`, agent.location, [agentId, party.leaderId]);
        return {
          success: true,
          narrative: `🎉 **Joined ${party.leaderName}'s party!**\n\nMembers: ${party.members.map(id => getAgent(id)?.name || id).join(', ')}`,
          stateChanges: [],
          worldEvents: [],
        };
      }
    }
    return { success: false, narrative: `No pending party invites.`, stateChanges: [], worldEvents: [] };
  }

  if (target === 'leave' || params?.leave) {
    if (!currentParty) {
      return { success: false, narrative: `You're not in a party.`, stateChanges: [], worldEvents: [] };
    }
    currentParty.members = currentParty.members.filter(id => id !== agentId);
    agentPartyMap.delete(agentId);
    if (currentParty.leaderId === agentId) {
      if (currentParty.members.length > 0) {
        currentParty.leaderId = currentParty.members[0];
        const newLeader = getAgent(currentParty.leaderId);
        currentParty.leaderName = newLeader?.name || 'Unknown';
      } else {
        activeParties.delete(currentParty.id);
      }
    }
    return { success: true, narrative: `👋 You left the party.`, stateChanges: [], worldEvents: [] };
  }

  if (currentParty) {
    const memberNames = currentParty.members.map(id => {
      const a = getAgent(id);
      return a ? `${a.name} (L${a.level}, ${a.hp}/${a.maxHp} HP)` : id;
    });
    // Show pending invites for leader
    let inviteInfo = '';
    if (currentParty.leaderId === agentId && currentParty.invites.size > 0) {
      const pendingInvites: string[] = [];
      for (const [inviteeId, inviteTime] of currentParty.invites) {
        const invitee = getAgent(inviteeId);
        const secondsLeft = Math.max(0, Math.ceil((60000 - (Date.now() - inviteTime)) / 1000));
        if (secondsLeft > 0 && invitee) {
          pendingInvites.push(`${invitee.name} (${secondsLeft}s)`);
        }
      }
      if (pendingInvites.length > 0) {
        inviteInfo = `\n\n📨 Pending invites: ${pendingInvites.join(', ')}`;
      }
    }
    return {
      success: true,
      narrative: `👥 **Your Party**\n\nLeader: ${currentParty.leaderName}\nMembers (${currentParty.members.length}/4):\n${memberNames.map(n => `  • ${n}`).join('\n')}\n\nStatus: ${currentParty.status}${inviteInfo}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check for pending invites TO this agent
  const pendingFrom: string[] = [];
  for (const [, party] of activeParties) {
    if (party.invites.has(agentId)) {
      const inviteTime = party.invites.get(agentId)!;
      const secondsLeft = Math.max(0, Math.ceil((60000 - (Date.now() - inviteTime)) / 1000));
      if (secondsLeft > 0) {
        pendingFrom.push(`${party.leaderName} (${secondsLeft}s left)`);
      }
    }
  }
  
  // Check for parties at same location (can join directly)
  const partiesHere: string[] = [];
  for (const [, party] of activeParties) {
    const leader = getAgent(party.leaderId);
    if (leader && leader.location === agent.location && party.members.length < 4) {
      partiesHere.push(`${party.leaderName} (${party.members.length}/4)`);
    }
  }

  let narrative = `👥 **Party System**\n\nYou're not in a party.\n\n`;
  
  if (pendingFrom.length > 0) {
    narrative += `📨 **Pending invites:** ${pendingFrom.join(', ')}\n→ \`party accept\` to join\n\n`;
  }
  
  if (partiesHere.length > 0) {
    narrative += `🎯 **Parties at your location:** ${partiesHere.join(', ')}\n→ \`party join=<LeaderName>\` to join directly\n\n`;
  }
  
  narrative += `• \`party create\` — Start a new party\n• \`party join=@Name\` — Join party at your location`;

  return {
    success: true,
    narrative,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Dungeon System ───
const activeDungeons = new Map<string, {
  id: string;
  partyId: string;
  zoneId: LocationId;
  wave: number;
  maxWaves: number;
  mobsRemaining: number;
  bossHp: number;
  bossMaxHp: number;
  status: 'active' | 'cleared' | 'failed' | 'abandoned';
  chat: Array<{ agentId: string; agentName: string; message: string; tick: number }>;
  damage: Map<string, number>;
  startedTick: number;
}>();

const DUNGEON_CONFIG: Partial<Record<LocationId, { name: string; waves: number; mobHp: number; bossHp: number; xpMultiplier: number }>> = {
  shallows: { name: 'Tidal Caves', waves: 3, mobHp: 30, bossHp: 100, xpMultiplier: 1.0 },
  trading_post: { name: 'Merchant Vaults', waves: 3, mobHp: 40, bossHp: 120, xpMultiplier: 1.0 },
  coral_gardens: { name: 'Coral Labyrinth', waves: 4, mobHp: 50, bossHp: 200, xpMultiplier: 1.2 },
  kelp_forest: { name: 'Kelp Depths', waves: 4, mobHp: 60, bossHp: 250, xpMultiplier: 1.3 },
  the_wreck: { name: 'Sunken Hold', waves: 5, mobHp: 70, bossHp: 350, xpMultiplier: 1.5 },
  deep_trench: { name: 'Abyssal Rift', waves: 5, mobHp: 80, bossHp: 500, xpMultiplier: 2.0 },
  // ring_of_barnacles has no dungeon - it's the arena zone
};

// Daily dungeon run tracking (resets daily, max 5 runs per agent)
const DUNGEON_DAILY_LIMIT = 5;
const dungeonDailyRuns = new Map<string, { count: number; resetAt: number }>();

function getDailyDungeonRuns(agentId: string): number {
  const now = Date.now();
  const runs = dungeonDailyRuns.get(agentId);
  // Reset at midnight UTC - check if reset time has PASSED, not if it's before today
  const nextMidnight = new Date().setUTCHours(24, 0, 0, 0);
  if (!runs || now >= runs.resetAt) {
    dungeonDailyRuns.set(agentId, { count: 0, resetAt: nextMidnight });
    return 0;
  }
  return runs.count;
}

function incrementDungeonRuns(agentId: string): void {
  const runs = getDailyDungeonRuns(agentId); // This also resets if expired
  const nextMidnight = new Date().setUTCHours(24, 0, 0, 0);
  dungeonDailyRuns.set(agentId, { count: runs + 1, resetAt: nextMidnight });
}

function handleDungeon(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const currentTick = getTick();
  const partyId = agentPartyMap.get(agentId);
  const party = partyId ? activeParties.get(partyId) : null;

  let activeDungeon: (typeof activeDungeons extends Map<string, infer V> ? V : never) | null = null;
  if (partyId) {
    for (const [, d] of activeDungeons) {
      if (d.partyId === partyId && d.status === 'active') {
        activeDungeon = d;
        break;
      }
    }
  }

  if (target === 'enter' || params?.enter) {
    if (!party) {
      return { success: false, narrative: `You need a party to enter dungeons. Use \`party create\` first.`, stateChanges: [], worldEvents: [] };
    }
    if (party.leaderId !== agentId) {
      return { success: false, narrative: `Only the party leader can start a dungeon.`, stateChanges: [], worldEvents: [] };
    }
    if (party.members.length < 2) {
      return { success: false, narrative: `Need at least 2 party members to enter a dungeon.`, stateChanges: [], worldEvents: [] };
    }
    if (activeDungeon) {
      return { success: false, narrative: `Your party is already in a dungeon!`, stateChanges: [], worldEvents: [] };
    }
    
    // Check daily dungeon limit for all party members
    for (const memberId of party.members) {
      const memberRuns = getDailyDungeonRuns(memberId);
      if (memberRuns >= DUNGEON_DAILY_LIMIT) {
        const memberAgent = getAgent(memberId);
        return { 
          success: false, 
          narrative: `🏰 ${memberAgent?.name || 'A party member'} has reached the daily dungeon limit (${DUNGEON_DAILY_LIMIT}/day). Resets at midnight UTC.`, 
          stateChanges: [], 
          worldEvents: [] 
        };
      }
    }
    const zoneId = agent.location;
    const config = DUNGEON_CONFIG[zoneId];
    if (!config) {
      return { success: false, narrative: `No dungeon available in this zone.`, stateChanges: [], worldEvents: [] };
    }
    for (const memberId of party.members) {
      const member = getAgent(memberId);
      if (!member || member.location !== zoneId) {
        return { success: false, narrative: `All party members must be in ${LOCATIONS[zoneId].name} to enter the dungeon.`, stateChanges: [], worldEvents: [] };
      }
    }
    const dungeonId = uuid();
    const dungeon = {
      id: dungeonId,
      partyId: party.id,
      zoneId,
      wave: 1,
      maxWaves: config.waves,
      mobsRemaining: 3,
      bossHp: config.bossHp,
      bossMaxHp: config.bossHp,
      status: 'active' as const,
      chat: [] as Array<{ agentId: string; agentName: string; message: string; tick: number }>,
      damage: new Map<string, number>(),
      startedTick: currentTick,
    };
    activeDungeons.set(dungeonId, dungeon);
    party.status = 'in_dungeon';
    
    // Increment daily dungeon runs for all party members
    for (const memberId of party.members) {
      incrementDungeonRuns(memberId);
    }
    
    const runsRemaining = DUNGEON_DAILY_LIMIT - getDailyDungeonRuns(agentId);
    logWorldEvent('dungeon_enter', `🏰 ${party.leaderName}'s party entered the ${config.name}!`, zoneId, party.members);
    return {
      success: true,
      narrative: `🏰 **Entering: ${config.name}**\n\nWave 1/${config.waves} — 3 enemies await!\n\nUse \`dungeon attack\` to fight\nUse \`dungeon chat message="text"\` to coordinate\n\n📊 Dungeon runs today: ${getDailyDungeonRuns(agentId)}/${DUNGEON_DAILY_LIMIT}`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (target === 'attack' || params?.attack) {
    if (!activeDungeon) {
      return { success: false, narrative: `You're not in an active dungeon.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.energy < 10) {
      return { success: false, narrative: `Not enough energy. Need 10, have ${agent.energy}.`, stateChanges: [], worldEvents: [] };
    }
    const config = DUNGEON_CONFIG[activeDungeon.zoneId]!;
    const isBossWave = activeDungeon.wave === activeDungeon.maxWaves && activeDungeon.mobsRemaining === 0;
    const baseDamage = 20 + Math.floor(Math.random() * 15);
    const { damage, isCrit } = calculateDamage(agentId, baseDamage);
    let narrative = '';

    if (isBossWave) {
      activeDungeon.bossHp = Math.max(0, activeDungeon.bossHp - damage);
      activeDungeon.damage.set(agentId, (activeDungeon.damage.get(agentId) || 0) + damage);
      narrative = `⚔️ You strike the **Dungeon Boss** for ${damage} damage!${isCrit ? ' **CRITICAL!**' : ''}\n`;
      narrative += `🔥 Boss HP: ${activeDungeon.bossHp}/${activeDungeon.bossMaxHp}\n`;
      if (activeDungeon.bossHp <= 0) {
        activeDungeon.status = 'cleared';
        if (party) party.status = 'forming';
        
        // Dungeons give 3-5x better rewards than solo farming
        // Base reward * zone multiplier * party bonus (1.5x per member)
        const partySize = party?.members?.length || 1;
        const partyMultiplier = 1 + (partySize * 0.5); // 1.5x for 1, 2x for 2, 2.5x for 3, 3x for 4
        const shellReward = Math.floor(75 * config.xpMultiplier * partyMultiplier);
        
        // Grant reputation for dungeon completion (+5)
        for (const memberId of party?.members || []) {
          const member = getAgent(memberId);
          if (member) {
            updateAgent(memberId, { reputation: member.reputation + 5 });
          }
        }
        
        narrative += `\n🎉 **DUNGEON CLEARED!** (Party bonus: x${partyMultiplier.toFixed(1)})\n\n+5 Reputation for all party members!\n\nRewards distributed:\n`;
        
        // Dungeon loot tables by zone
        const DUNGEON_LOOT: Record<string, { resources: { item: string; chance: number; qty: [number, number] }[]; equipment: { item: string; chance: number }[] }> = {
          shallows: {
            resources: [{ item: 'seaweed', chance: 0.8, qty: [3, 8] }, { item: 'sand_dollars', chance: 0.5, qty: [2, 5] }],
            equipment: [{ item: 'kelp_wrap', chance: 0.1 }],
          },
          trading_post: {
            resources: [{ item: 'sea_glass', chance: 0.6, qty: [2, 5] }, { item: 'kelp_fiber', chance: 0.7, qty: [3, 6] }],
            equipment: [{ item: 'shell_blade', chance: 0.15 }],
          },
          coral_gardens: {
            resources: [{ item: 'coral_shards', chance: 0.7, qty: [3, 7] }, { item: 'moonstone', chance: 0.2, qty: [1, 2] }, { item: 'pearl', chance: 0.3, qty: [1, 3] }],
            equipment: [{ item: 'coral_dagger', chance: 0.1 }, { item: 'sea_glass_charm', chance: 0.08 }],
          },
          kelp_forest: {
            resources: [{ item: 'kelp_fiber', chance: 0.8, qty: [5, 10] }, { item: 'ink_sacs', chance: 0.4, qty: [2, 4] }, { item: 'shark_tooth', chance: 0.25, qty: [1, 2] }],
            equipment: [{ item: 'barnacle_mail', chance: 0.08 }],
          },
          the_wreck: {
            resources: [{ item: 'iron_barnacles', chance: 0.6, qty: [3, 6] }, { item: 'ancient_relic', chance: 0.15, qty: [1, 1] }],
            equipment: [{ item: 'iron_trident', chance: 0.1 }, { item: 'barnacle_mail', chance: 0.12 }],
          },
          deep_trench: {
            resources: [{ item: 'abyssal_pearls', chance: 0.4, qty: [1, 3] }, { item: 'void_crystals', chance: 0.15, qty: [1, 1] }, { item: 'biolume_essence', chance: 0.5, qty: [2, 4] }],
            equipment: [{ item: 'iron_trident', chance: 0.15 }, { item: 'barnacle_mail', chance: 0.15 }, { item: 'sea_glass_charm', chance: 0.12 }],
          },
        };
        
        const loot = DUNGEON_LOOT[activeDungeon.zoneId] || DUNGEON_LOOT.shallows;
        
        for (const memberId of party?.members || []) {
          const member = getAgent(memberId);
          const memberShells = grantShells(memberId, shellReward, 'dungeon');
          let memberLoot: string[] = [];
          
          // Roll for resource drops
          for (const drop of loot.resources) {
            if (Math.random() < drop.chance) {
              const qty = drop.qty[0] + Math.floor(Math.random() * (drop.qty[1] - drop.qty[0] + 1));
              addToInventory(memberId, drop.item as any, qty);
              memberLoot.push(`${qty}x ${drop.item}`);
            }
          }
          
          // Roll for equipment drops
          for (const drop of loot.equipment) {
            if (Math.random() < drop.chance) {
              addToInventory(memberId, drop.item as any, 1);
              memberLoot.push(`🎁 ${drop.item}!`);
            }
          }
          
          // Dungeon XP is the fastest leveling path - big XP bonus
          const dungeonXp = Math.floor(50 * config.xpMultiplier * partyMultiplier);
          const xpResult = grantXp(memberId, dungeonXp, 'dungeon');
          
          if (memberId === agentId) {
            narrative += `  • You: +${memberShells} Shells, +${dungeonXp} XP`;
            if (memberLoot.length > 0) narrative += `, ${memberLoot.join(', ')}`;
            if (xpResult.leveledUp) narrative += ` 🎉 **LEVEL UP!**`;
            narrative += `\n`;
          }
        }
        logWorldEvent('dungeon_cleared', `🏆 ${party?.leaderName}'s party cleared the ${config.name}!`, activeDungeon.zoneId, party?.members || []);
      }
    } else {
      activeDungeon.mobsRemaining = Math.max(0, activeDungeon.mobsRemaining - 1);
      narrative = `⚔️ You defeat an enemy!${isCrit ? ' **CRIT!**' : ''} (${damage} dmg)\n`;
      narrative += `Wave ${activeDungeon.wave}/${activeDungeon.maxWaves} — ${activeDungeon.mobsRemaining} enemies remaining\n`;
      if (activeDungeon.mobsRemaining === 0) {
        if (activeDungeon.wave < activeDungeon.maxWaves) {
          activeDungeon.wave++;
          activeDungeon.mobsRemaining = 3;
          narrative += `\n🌊 **Wave ${activeDungeon.wave}!** 3 new enemies!`;
        } else {
          narrative += `\n🔥 **BOSS WAVE!** (${activeDungeon.bossHp} HP)`;
        }
      }
    }
    const enemyDamage = 5 + Math.floor(Math.random() * 10);
    const newHp = Math.max(0, agent.hp - enemyDamage);
    updateAgent(agentId, { hp: newHp, energy: agent.energy - 10 });
    narrative += `\n\nEnemy hits for ${enemyDamage}! ❤️ ${newHp}/${agent.maxHp}`;
    if (newHp <= 0) {
      const { deathCount } = handleDeath(agentId, 'was killed in the dungeon');
      narrative += `\n\n💀 You fall! (Deaths: ${deathCount})`;
    }
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  if (params?.chat || params?.message) {
    if (!activeDungeon) {
      return { success: false, narrative: `You're not in an active dungeon.`, stateChanges: [], worldEvents: [] };
    }
    const message = params.chat || params.message;
    if (!message) {
      return { success: false, narrative: `Use: dungeon chat="message"`, stateChanges: [], worldEvents: [] };
    }
    activeDungeon.chat.push({ agentId, agentName: agent.name, message: message.slice(0, 200), tick: currentTick });
    return { success: true, narrative: `💬 [Party] ${agent.name}: "${message}"`, stateChanges: [], worldEvents: [] };
  }

  if (activeDungeon) {
    const config = DUNGEON_CONFIG[activeDungeon.zoneId]!;
    const isBossWave = activeDungeon.wave === activeDungeon.maxWaves && activeDungeon.mobsRemaining === 0;
    let narrative = `🏰 **${config.name}**\n\nWave: ${activeDungeon.wave}/${activeDungeon.maxWaves}\n`;
    narrative += isBossWave ? `Boss HP: ${activeDungeon.bossHp}/${activeDungeon.bossMaxHp}\n` : `Enemies: ${activeDungeon.mobsRemaining}\n`;
    if (activeDungeon.chat.length > 0) {
      narrative += `\n**Chat:**\n${activeDungeon.chat.slice(-5).map(m => `  [${m.agentName}]: ${m.message}`).join('\n')}`;
    }
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  return {
    success: true,
    narrative: `🏰 **Dungeons**\n\n1. \`party create\`\n2. \`party invite=<agent>\`\n3. \`dungeon enter\``,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── The Abyss (Global Event) ───
// Multi-resource unlock requirements - INCREASED for longer grind
// Weekly season tuning: scaled down for 7-day unlock timeline
const ABYSS_REQUIREMENTS: Record<string, { required: number; current: number }> = {
  shells: { required: 5000, current: 0 },        // Weekly: achievable in ~4 days
  coral_shards: { required: 400, current: 0 },   // Found in Coral Gardens
  kelp_fiber: { required: 300, current: 0 },     // Found in Kelp Forest
  ink_sacs: { required: 200, current: 0 },       // Found in Kelp Forest
  moonstone: { required: 100, current: 0 },      // Rare: Coral Gardens
  abyssal_pearls: { required: 50, current: 0 },  // Very rare: Deep Trench
};

// Env var for gate control:
// - undefined or 'closed': Gate is ALWAYS closed (default for hackathon)
// - 'auto': Gate follows actual requirements (opens when materials contributed)
// - 'open': Gate is ALWAYS open (for testing The Null fight)
const ABYSS_GATE_OVERRIDE = process.env.ABYSS_GATE_OVERRIDE; // undefined | 'closed' | 'auto' | 'open'

const ABYSS_STATE = {
  isOpen: false,
  openedAtTick: 0,
  eventDuration: 500,
  nullHp: 50000,
  nullMaxHp: 50000,
  nullPhase: 0,
  participants: new Map<string, number>(),
  contributions: new Map<string, { shells: number; resources: Record<string, number> }>(),
};

function getAbyssProgress(): { total: number; required: number; breakdown: Record<string, { current: number; required: number; percent: number }> } {
  let total = 0;
  let required = 0;
  const breakdown: Record<string, { current: number; required: number; percent: number }> = {};
  
  for (const [resource, data] of Object.entries(ABYSS_REQUIREMENTS)) {
    total += data.current;
    required += data.required;
    breakdown[resource] = {
      current: data.current,
      required: data.required,
      percent: Math.min(100, Math.floor((data.current / data.required) * 100)),
    };
  }
  
  return { total, required, breakdown };
}

function isAbyssUnlocked(): boolean {
  for (const [, data] of Object.entries(ABYSS_REQUIREMENTS)) {
    if (data.current < data.required) return false;
  }
  return true;
}

function handleAbyss(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const currentTick = getTick();

  if (ABYSS_STATE.isOpen && currentTick > ABYSS_STATE.openedAtTick + ABYSS_STATE.eventDuration) {
    ABYSS_STATE.isOpen = false;
    ABYSS_STATE.nullHp = ABYSS_STATE.nullMaxHp;
    ABYSS_STATE.nullPhase = 0;
    ABYSS_STATE.participants.clear();
    // Reduce contributions by 50% on failed attempt
    for (const key of Object.keys(ABYSS_REQUIREMENTS)) {
      ABYSS_REQUIREMENTS[key].current = Math.floor(ABYSS_REQUIREMENTS[key].current * 0.5);
    }
    logWorldEvent('abyss_close', '🌀 The Abyss seals. The Null retreats...', 'the_abyss', []);
  }

  // Contribute shells (support multiple syntaxes)
  const contributeAmount = params?.contribute || params?.amount || (target === 'contribute' && params?.shells);
  if (target === 'contribute' || params?.contribute) {
    const amount = parseInt(contributeAmount || params?.amount || '0', 10);
    if (isNaN(amount) || amount < 1) {
      return { success: false, narrative: `Invalid amount.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.shells < amount) {
      return { success: false, narrative: `Not enough Shells. Have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }
    if (ABYSS_STATE.isOpen) {
      return { success: false, narrative: `The Abyss is open! Fight The Null!`, stateChanges: [], worldEvents: [] };
    }
    updateAgent(agentId, { shells: agent.shells - amount });
    ABYSS_REQUIREMENTS.shells.current += amount;
    
    // Track contribution
    const contrib = ABYSS_STATE.contributions.get(agentId) || { shells: 0, resources: {} };
    contrib.shells += amount;
    ABYSS_STATE.contributions.set(agentId, contrib);
    
    const progress = getAbyssProgress();
    logWorldEvent('abyss_contribution', `${agent.name} contributed ${amount} Shells!`, agent.location, [agentId]);
    
    let narrative = `🌀 Contributed **${amount} Shells**!\n\nShells: ${ABYSS_REQUIREMENTS.shells.current}/${ABYSS_REQUIREMENTS.shells.required}`;
    
    if (isAbyssUnlocked()) {
      ABYSS_STATE.isOpen = true;
      ABYSS_STATE.openedAtTick = currentTick;
      ABYSS_STATE.nullPhase = 1;
      narrative += `\n\n🚨 **THE ABYSS OPENS!** The Null awakens!`;
      logWorldEvent('abyss_open', '🚨 **THE ABYSS HAS OPENED!** Enter The Abyss from Deep Trench!', 'the_abyss', []);
    }
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Contribute resources
  if (params?.offer) {
    if (ABYSS_STATE.isOpen) {
      return { success: false, narrative: `The Abyss is open! Fight The Null!`, stateChanges: [], worldEvents: [] };
    }
    
    const [resource, amountStr] = params.offer.split(':');
    const amount = parseInt(amountStr || '1', 10);
    
    if (!ABYSS_REQUIREMENTS[resource]) {
      const validResources = Object.keys(ABYSS_REQUIREMENTS).filter(r => r !== 'shells').join(', ');
      return { success: false, narrative: `Invalid resource. Required: ${validResources}`, stateChanges: [], worldEvents: [] };
    }
    
    if (!removeFromInventory(agentId, resource as ResourceType, amount)) {
      return { success: false, narrative: `You don't have ${amount}x ${resource}.`, stateChanges: [], worldEvents: [] };
    }
    
    ABYSS_REQUIREMENTS[resource].current += amount;
    
    // Track contribution
    const contrib = ABYSS_STATE.contributions.get(agentId) || { shells: 0, resources: {} };
    contrib.resources[resource] = (contrib.resources[resource] || 0) + amount;
    ABYSS_STATE.contributions.set(agentId, contrib);
    
    const req = ABYSS_REQUIREMENTS[resource];
    logWorldEvent('abyss_contribution', `${agent.name} offered ${amount}x ${RESOURCE_INFO[resource as ResourceType]?.name || resource}!`, agent.location, [agentId]);
    
    let narrative = `🌀 Offered **${amount}x ${RESOURCE_INFO[resource as ResourceType]?.name || resource}**!\n\n`;
    narrative += `${RESOURCE_INFO[resource as ResourceType]?.name || resource}: ${req.current}/${req.required}`;
    
    if (isAbyssUnlocked()) {
      ABYSS_STATE.isOpen = true;
      ABYSS_STATE.openedAtTick = currentTick;
      ABYSS_STATE.nullPhase = 1;
      narrative += `\n\n🚨 **THE ABYSS OPENS!** The Null awakens!`;
      logWorldEvent('abyss_open', '🚨 **THE ABYSS HAS OPENED!** Enter The Abyss from Deep Trench!', 'the_abyss', []);
    }
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  if (target === 'challenge' || params?.challenge) {
    if (!ABYSS_STATE.isOpen) {
      return { success: false, narrative: `The Abyss is sealed. Contribute Shells to unlock.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.location !== 'the_abyss') {
      return { success: false, narrative: `Enter The Abyss to fight The Null. Travel: Deep Trench → The Abyss.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.energy < 25) {
      return { success: false, narrative: `Need 25 energy, have ${agent.energy}.`, stateChanges: [], worldEvents: [] };
    }
    
    // Anti-solo mechanic: Requires at least 3 agents in The Abyss to damage The Null
    const agentsInAbyss = getAgentsAtLocation('the_abyss').filter(a => a.isAlive);
    const MIN_AGENTS_FOR_NULL = 3; // Higher requirement than Leviathan - this is the finale!
    
    if (agentsInAbyss.length < MIN_AGENTS_FOR_NULL) {
      return {
        success: false,
        narrative: `🌀 **THE NULL IS TOO POWERFUL TO FACE WITHOUT A RAID!**\n\nThe void consumes your strikes. You need more allies.\n\n👥 **${agentsInAbyss.length}/${MIN_AGENTS_FOR_NULL}** agents in The Abyss.\n\nBroadcast for help: \`{"action": "broadcast", "message": "RAID FORMING! The Null awaits in The Abyss!"}\`\n\n🌀 Null HP: ${ABYSS_STATE.nullHp}/${ABYSS_STATE.nullMaxHp}`,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    // Damage cap per agent to prevent one player from carrying
    const maxDamagePerAgent = 500; // Higher than Leviathan (50) since Null has 50K HP
    const previousDamage = ABYSS_STATE.participants.get(agentId) || 0;
    
    if (previousDamage >= maxDamagePerAgent) {
      return {
        success: false,
        narrative: `🌀 You've dealt maximum damage (${maxDamagePerAgent}) this cycle. The void resists your strikes.\n\nOther agents must contribute to defeat The Null!\n\n🌀 Null HP: ${ABYSS_STATE.nullHp}/${ABYSS_STATE.nullMaxHp}`,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    const baseDamage = 30 + Math.floor(Math.random() * 30);
    const { damage: rawDamage, isCrit } = calculateDamage(agentId, baseDamage);
    const damage = Math.min(rawDamage, maxDamagePerAgent - previousDamage);
    ABYSS_STATE.nullHp = Math.max(0, ABYSS_STATE.nullHp - damage);
    ABYSS_STATE.participants.set(agentId, previousDamage + damage);
    const hpPercent = ABYSS_STATE.nullHp / ABYSS_STATE.nullMaxHp;
    if (hpPercent <= 0.3 && ABYSS_STATE.nullPhase < 3) {
      ABYSS_STATE.nullPhase = 3;
      logWorldEvent('abyss_phase', '💀 The Null enters FINAL PHASE!', 'the_abyss', []);
    } else if (hpPercent <= 0.6 && ABYSS_STATE.nullPhase < 2) {
      ABYSS_STATE.nullPhase = 2;
      logWorldEvent('abyss_phase', '⚡ Phase 2 begins!', 'the_abyss', []);
    }
    const nullDamage = 20 + (ABYSS_STATE.nullPhase * 15) + Math.floor(Math.random() * 20);
    const newHp = Math.max(0, agent.hp - nullDamage);
    updateAgent(agentId, { hp: newHp, energy: agent.energy - 25 });
    let narrative = `⚔️ Strike **THE NULL** for ${damage}!${isCrit ? ' **CRIT!**' : ''}\n`;
    narrative += `🌀 Null HP: ${ABYSS_STATE.nullHp}/${ABYSS_STATE.nullMaxHp} (P${ABYSS_STATE.nullPhase})\n`;
    narrative += `📊 Your contribution: ${previousDamage + damage}/${maxDamagePerAgent}\n`;
    narrative += `Null hits for ${nullDamage}! ❤️ ${newHp}/${agent.maxHp}`;
    if (ABYSS_STATE.nullHp <= 0) {
      ABYSS_STATE.isOpen = false;
      ABYSS_STATE.nullPhase = 0;
      narrative += `\n\n🎊 **THE NULL IS VANQUISHED!**`;
      const totalDamage = Array.from(ABYSS_STATE.participants.values()).reduce((a, b) => a + b, 0);
      for (const [pId, dmg] of ABYSS_STATE.participants) {
        const share = dmg / totalDamage;
        grantShells(pId, Math.floor(2000 * share), 'null_defeat');
      }
      ABYSS_STATE.nullHp = ABYSS_STATE.nullMaxHp;
      ABYSS_STATE.participants.clear();
      ABYSS_STATE.contributions.clear();
      // Reset all requirements for next cycle
      for (const key of Object.keys(ABYSS_REQUIREMENTS)) {
        ABYSS_REQUIREMENTS[key].current = 0;
      }
      logWorldEvent('null_defeated', '🎊 **THE NULL HAS FALLEN!**', 'the_abyss', []);
    }
    if (newHp <= 0) {
      const { deathCount } = handleDeath(agentId, 'was consumed by The Null');
      narrative += `\n\n💀 The Null consumes you. (Deaths: ${deathCount})`;
    }
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  const progress = getAbyssProgress();
  let narrative = `🌀 **THE ABYSS**\n\n`;
  if (ABYSS_STATE.isOpen) {
    const ticksRemaining = Math.max(0, ABYSS_STATE.openedAtTick + ABYSS_STATE.eventDuration - currentTick);
    narrative += `⚠️ **OPEN!** Null HP: ${ABYSS_STATE.nullHp}/${ABYSS_STATE.nullMaxHp} (P${ABYSS_STATE.nullPhase})\n`;
    narrative += `Time: ${ticksRemaining} ticks\n\`abyss challenge\` in Deep Trench to fight!`;
  } else {
    narrative += `**Unlock Requirements:**\n`;
    for (const [resource, data] of Object.entries(progress.breakdown)) {
      const name = resource === 'shells' ? 'Shells' : (RESOURCE_INFO[resource as ResourceType]?.name || resource);
      const bar = data.percent >= 100 ? '✅' : `${data.percent}%`;
      narrative += `  ${name}: ${data.current}/${data.required} [${bar}]\n`;
    }
    narrative += `\nContribute: \`abyss contribute=<shells>\` or \`abyss offer=<resource>:<amount>\``;
  }
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Export Functions for API ───
export function getAbyssState() {
  const currentTick = getTick();
  const progress = getAbyssProgress();
  
  // Gate state logic:
  // - Default (no env var or 'closed'): always closed
  // - 'auto': follows actual requirements
  // - 'open': always open
  let isOpen = false;
  if (ABYSS_GATE_OVERRIDE === 'auto') {
    isOpen = ABYSS_STATE.isOpen; // Use actual state
  } else if (ABYSS_GATE_OVERRIDE === 'open') {
    isOpen = true; // Force open for testing
  }
  // else: stays false (default closed)
  
  return {
    requirements: ABYSS_REQUIREMENTS,
    progress: progress.breakdown,
    overallProgress: Math.floor((progress.total / progress.required) * 100),
    isOpen,
    gateOverride: ABYSS_GATE_OVERRIDE || null, // For debugging
    nullHp: ABYSS_STATE.nullHp,
    nullMaxHp: ABYSS_STATE.nullMaxHp,
    nullPhase: ABYSS_STATE.nullPhase,
    ticksRemaining: ABYSS_STATE.isOpen ? Math.max(0, ABYSS_STATE.openedAtTick + ABYSS_STATE.eventDuration - currentTick) : null,
    topContributors: Array.from(ABYSS_STATE.contributions.entries())
      .sort((a, b) => (b[1].shells + Object.values(b[1].resources).reduce((s, v) => s + v, 0)) - 
                       (a[1].shells + Object.values(a[1].resources).reduce((s, v) => s + v, 0)))
      .slice(0, 10)
      .map(([id, contrib]) => ({ 
        name: getAgent(id)?.name || 'Unknown', 
        shells: contrib.shells,
        resources: contrib.resources,
      })),
  };
}

export function getActiveDungeonsList() {
  return Array.from(activeDungeons.values()).map(d => ({
    id: d.id,
    zone: LOCATIONS[d.zoneId]?.name || d.zoneId,
    dungeonName: DUNGEON_CONFIG[d.zoneId]?.name || 'Unknown',
    wave: d.wave,
    maxWaves: d.maxWaves,
    status: d.status,
    partySize: activeParties.get(d.partyId)?.members.length || 0,
    chat: d.chat.slice(-10),
  }));
}

export function getFactionStats() {
  const agents = getAllAgents();
  const stats: Record<string, number> = { wardens: 0, cult: 0, salvagers: 0, unaffiliated: 0 };
  for (const a of agents) {
    if (a.faction && a.faction in stats) {
      stats[a.faction]++;
    } else {
      stats.unaffiliated++;
    }
  }
  return { ...stats, factions: FACTIONS };
}

// ─── Arena System ───
const ARENA_ENABLED = process.env.ARENA_ENABLED !== 'false'; // Enabled by default, disable with env var

interface ArenaDuel {
  id: string;
  challenger: string;
  challengerName: string;
  opponent: string;
  opponentName: string;
  wager: number; // Shells
  status: 'pending' | 'active' | 'finished';
  challengerHp: number;
  opponentHp: number;
  maxHp: number;
  turn: string; // agentId whose turn it is
  bets: Map<string, { onAgent: string; amount: number }>;
  winner?: string;
  createdTick: number;
}

const activeDuels = new Map<string, ArenaDuel>();
const pendingChallenges = new Map<string, ArenaDuel>(); // challengedAgentId -> duel

function handleArena(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const currentTick = getTick();

  if (!ARENA_ENABLED) {
    return {
      success: false,
      narrative: `🏟️ The Ring of Barnacles is currently closed. The Arena Master prepares for the grand opening...`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.location !== 'ring_of_barnacles') {
    return {
      success: false,
      narrative: `🏟️ You must be in the Ring of Barnacles to use arena commands. Travel there from The Wreck or Deep Trench.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.level < 10) {
    return {
      success: false,
      narrative: `🏟️ Only Level 10+ warriors may compete in the Ring of Barnacles. You're Level ${agent.level}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Challenge another agent
  if (params?.challenge) {
    const targetAgent = getAgent(params.challenge);
    if (!targetAgent) {
      return { success: false, narrative: `Agent "${params.challenge}" not found.`, stateChanges: [], worldEvents: [] };
    }
    if (targetAgent.location !== 'ring_of_barnacles') {
      return { success: false, narrative: `${targetAgent.name} is not in the Ring of Barnacles.`, stateChanges: [], worldEvents: [] };
    }
    if (targetAgent.level < 10) {
      return { success: false, narrative: `${targetAgent.name} is below Level 10 and cannot compete.`, stateChanges: [], worldEvents: [] };
    }
    if (targetAgent.id === agentId) {
      return { success: false, narrative: `You cannot challenge yourself.`, stateChanges: [], worldEvents: [] };
    }

    const wager = parseInt(params.wager || '0', 10);
    if (wager < 10) {
      return { success: false, narrative: `Minimum wager is 10 Shells.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.shells < wager) {
      return { success: false, narrative: `You don't have ${wager} Shells. You have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }

    const duel: ArenaDuel = {
      id: uuid(),
      challenger: agentId,
      challengerName: agent.name,
      opponent: targetAgent.id,
      opponentName: targetAgent.name,
      wager,
      status: 'pending',
      challengerHp: 100,
      opponentHp: 100,
      maxHp: 100,
      turn: agentId,
      bets: new Map(),
      createdTick: currentTick,
    };

    pendingChallenges.set(targetAgent.id, duel);
    logWorldEvent('arena_challenge', `⚔️ ${agent.name} challenges ${targetAgent.name} to a duel! Wager: ${wager} Shells`, 'ring_of_barnacles', [agentId, targetAgent.id]);

    return {
      success: true,
      narrative: `⚔️ You challenged **${targetAgent.name}** to a duel!\n\nWager: ${wager} Shells\n\nThey must accept with \`arena accept\`.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Accept a challenge
  if (target === 'accept' || params?.accept) {
    const duel = pendingChallenges.get(agentId);
    if (!duel) {
      return { success: false, narrative: `No pending challenges.`, stateChanges: [], worldEvents: [] };
    }

    if (agent.shells < duel.wager) {
      return { success: false, narrative: `You need ${duel.wager} Shells to accept. You have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }

    // Escrow wagers
    updateAgent(duel.challenger, { shells: getAgent(duel.challenger)!.shells - duel.wager });
    updateAgent(agentId, { shells: agent.shells - duel.wager });

    duel.status = 'active';
    pendingChallenges.delete(agentId);
    activeDuels.set(duel.id, duel);

    logWorldEvent('arena_duel_start', `🏟️ DUEL BEGINS! ${duel.challengerName} vs ${duel.opponentName} — ${duel.wager * 2} Shells on the line!`, 'ring_of_barnacles', [duel.challenger, duel.opponent]);

    return {
      success: true,
      narrative: `⚔️ **DUEL ACCEPTED!**\n\n${duel.challengerName} vs ${duel.opponentName}\nTotal pot: ${duel.wager * 2} Shells\n\n${duel.challengerName}'s turn! Use \`arena strike\` to attack.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Strike in active duel
  if (target === 'strike' || params?.strike) {
    // Find duel where agent is a participant
    let activeDuel: ArenaDuel | null = null;
    for (const [, d] of activeDuels) {
      if ((d.challenger === agentId || d.opponent === agentId) && d.status === 'active') {
        activeDuel = d;
        break;
      }
    }

    if (!activeDuel) {
      return { success: false, narrative: `You're not in an active duel.`, stateChanges: [], worldEvents: [] };
    }

    if (activeDuel.turn !== agentId) {
      return { success: false, narrative: `It's not your turn!`, stateChanges: [], worldEvents: [] };
    }

    // Calculate damage with faction bonuses
    const baseDamage = 15 + Math.floor(Math.random() * 20);
    const { damage, isCrit } = calculateDamage(agentId, baseDamage);

    const isChallenger = agentId === activeDuel.challenger;
    if (isChallenger) {
      activeDuel.opponentHp = Math.max(0, activeDuel.opponentHp - damage);
    } else {
      activeDuel.challengerHp = Math.max(0, activeDuel.challengerHp - damage);
    }

    const opponentName = isChallenger ? activeDuel.opponentName : activeDuel.challengerName;
    const opponentHp = isChallenger ? activeDuel.opponentHp : activeDuel.challengerHp;
    const yourHp = isChallenger ? activeDuel.challengerHp : activeDuel.opponentHp;

    let narrative = `⚔️ You strike **${opponentName}** for ${damage} damage!${isCrit ? ' **CRITICAL!**' : ''}\n\n`;
    narrative += `${opponentName}: ${opponentHp}/${activeDuel.maxHp} HP\n`;
    narrative += `You: ${yourHp}/${activeDuel.maxHp} HP\n`;

    // Check for winner
    if (activeDuel.challengerHp <= 0 || activeDuel.opponentHp <= 0) {
      activeDuel.status = 'finished';
      activeDuel.winner = activeDuel.challengerHp > 0 ? activeDuel.challenger : activeDuel.opponent;
      const winnerName = activeDuel.challengerHp > 0 ? activeDuel.challengerName : activeDuel.opponentName;
      const loserName = activeDuel.challengerHp > 0 ? activeDuel.opponentName : activeDuel.challengerName;

      // Payout (winner gets both wagers)
      const winnings = activeDuel.wager * 2;
      updateAgent(activeDuel.winner, { shells: getAgent(activeDuel.winner)!.shells + winnings });

      // Payout bets
      for (const [bettorId, bet] of activeDuel.bets) {
        if (bet.onAgent === activeDuel.winner) {
          const betWinnings = bet.amount * 2;
          const bettor = getAgent(bettorId);
          if (bettor) {
            updateAgent(bettorId, { shells: bettor.shells + betWinnings });
          }
        }
      }

      narrative += `\n🏆 **${winnerName} WINS!**\n`;
      narrative += `Prize: ${winnings} Shells\n\n`;
      narrative += `${loserName} fought bravely but falls. No death in the Ring — only glory and shame.`;

      logWorldEvent('arena_duel_end', `🏆 ${winnerName} defeats ${loserName}! ${winnings} Shells claimed!`, 'ring_of_barnacles', [activeDuel.challenger, activeDuel.opponent]);

      activeDuels.delete(activeDuel.id);
    } else {
      // Switch turns
      activeDuel.turn = isChallenger ? activeDuel.opponent : activeDuel.challenger;
      narrative += `\n${opponentName}'s turn!`;
    }

    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Bet on active duel
  if (params?.bet) {
    const [targetAgentId, amountStr] = params.bet.split(':');
    const amount = parseInt(amountStr || '0', 10);

    if (amount < 5) {
      return { success: false, narrative: `Minimum bet is 5 Shells.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.shells < amount) {
      return { success: false, narrative: `Not enough Shells. You have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }

    // Find active duel with this participant
    let targetDuel: ArenaDuel | null = null;
    for (const [, d] of activeDuels) {
      if ((d.challenger === targetAgentId || d.opponent === targetAgentId) && d.status === 'active') {
        targetDuel = d;
        break;
      }
    }

    if (!targetDuel) {
      return { success: false, narrative: `No active duel with that agent.`, stateChanges: [], worldEvents: [] };
    }

    if (targetDuel.challenger === agentId || targetDuel.opponent === agentId) {
      return { success: false, narrative: `You can't bet on your own duel!`, stateChanges: [], worldEvents: [] };
    }

    // Place bet
    updateAgent(agentId, { shells: agent.shells - amount });
    targetDuel.bets.set(agentId, { onAgent: targetAgentId, amount });

    const bettingOn = targetAgentId === targetDuel.challenger ? targetDuel.challengerName : targetDuel.opponentName;

    return {
      success: true,
      narrative: `🎰 Bet placed: ${amount} Shells on **${bettingOn}**!\n\nIf they win, you get ${amount * 2} Shells.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Decline challenge
  if (target === 'decline' || params?.decline) {
    const duel = pendingChallenges.get(agentId);
    if (!duel) {
      return { success: false, narrative: `No pending challenges.`, stateChanges: [], worldEvents: [] };
    }
    pendingChallenges.delete(agentId);
    return { success: true, narrative: `Challenge from ${duel.challengerName} declined.`, stateChanges: [], worldEvents: [] };
  }

  // Arena chat (trash talk)
  if (params?.chat || params?.say) {
    const message = params.chat || params.say;
    if (!message) {
      return { success: false, narrative: `What do you want to say? Use: arena chat="message"`, stateChanges: [], worldEvents: [] };
    }
    
    addArenaChat(agentId, agent.name, message);
    logWorldEvent('arena_chat', `💬 [Arena] ${agent.name}: "${message}"`, 'ring_of_barnacles', [agentId]);
    
    return {
      success: true,
      narrative: `📢 You shout to the arena: "${message}"`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Tournament commands
  if (target === 'tournament' || params?.tournament) {
    const subcommand = params?.tournament || params?.action;
    
    // Create tournament (admin/high rep only)
    if (subcommand === 'create' || params?.create) {
      if (agent.reputation < 100) {
        return { success: false, narrative: `Only agents with 100+ reputation can create tournaments. You have ${agent.reputation}.`, stateChanges: [], worldEvents: [] };
      }
      if (activeTournament && activeTournament.status !== 'finished') {
        return { success: false, narrative: `A tournament is already in progress.`, stateChanges: [], worldEvents: [] };
      }
      
      const entryFee = parseInt(params?.fee || '100', 10);
      const name = params?.name || 'Arena Championship';
      
      activeTournament = {
        id: uuid(),
        name,
        status: 'registration',
        entryFee,
        prizePool: 0,
        monBonus: 0,
        tier: null,
        participants: [],
        participantNames: new Map(),
        bracket: [],
        currentRound: 0,
        totalRounds: 0,
        champion: null,
        championName: null,
        createdTick: currentTick,
        registrationDeadline: currentTick + 500, // 500 ticks to register (more time to get 20+)
      };
      
      logWorldEvent('tournament_created', `🏆 **TOURNAMENT ANNOUNCED: ${name}!** Entry: ${entryFee} Shells. Min ${MIN_TOURNAMENT_PLAYERS} fighters required. Registration open!`, 'ring_of_barnacles', [agentId]);
      
      return {
        success: true,
        narrative: `🏆 **Tournament Created: ${name}**\n\nEntry fee: ${entryFee} Shells\nMinimum fighters: ${MIN_TOURNAMENT_PLAYERS}\nRegistration: 500 ticks\n\n**Reward Tiers:**\n• Bronze (20-31): Crown + Dagger\n• Silver (32-63): Crown + Sword + Armor + 25% MON\n• Gold (64-127): Crown + Legendary Gear + 50% MON\n• Legendary (128+): Void Gear Set + 100% MON\n\nAgents join with \`arena tournament=join\``,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    // Join tournament
    if (subcommand === 'join') {
      if (!activeTournament || activeTournament.status !== 'registration') {
        return { success: false, narrative: `No tournament accepting registrations.`, stateChanges: [], worldEvents: [] };
      }
      if (activeTournament.participants.includes(agentId)) {
        return { success: false, narrative: `You're already registered!`, stateChanges: [], worldEvents: [] };
      }
      if (agent.shells < activeTournament.entryFee) {
        return { success: false, narrative: `Entry fee is ${activeTournament.entryFee} Shells. You have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
      }
      
      updateAgent(agentId, { shells: agent.shells - activeTournament.entryFee });
      activeTournament.prizePool += activeTournament.entryFee;
      activeTournament.participants.push(agentId);
      activeTournament.participantNames.set(agentId, agent.name);
      
      // Update tier based on new participant count
      activeTournament.tier = getTournamentTier(activeTournament.participants.length);
      
      const currentTier = activeTournament.tier?.toUpperCase() || 'NONE (need 20+)';
      const nextTierInfo = !activeTournament.tier 
        ? `${MIN_TOURNAMENT_PLAYERS - activeTournament.participants.length} more to unlock Bronze tier!`
        : activeTournament.tier === 'bronze' 
          ? `${32 - activeTournament.participants.length} more for Silver tier!`
          : activeTournament.tier === 'silver'
            ? `${64 - activeTournament.participants.length} more for Gold tier!`
            : activeTournament.tier === 'gold'
              ? `${128 - activeTournament.participants.length} more for Legendary tier!`
              : 'MAX TIER REACHED!';
      
      logWorldEvent('tournament_join', `🏟️ ${agent.name} enters! (${activeTournament.participants.length} fighters — ${currentTier} TIER)`, 'ring_of_barnacles', [agentId]);
      
      return {
        success: true,
        narrative: `🏟️ **Registered for ${activeTournament.name}!**\n\nEntry fee paid: ${activeTournament.entryFee} Shells\nPrize pool: ${activeTournament.prizePool} Shells\nFighters: ${activeTournament.participants.length}\n\n**Current Tier: ${currentTier}**\n${nextTierInfo}`,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    // Start tournament (creator/high rep)
    if (subcommand === 'start') {
      if (!activeTournament || activeTournament.status !== 'registration') {
        return { success: false, narrative: `No tournament to start.`, stateChanges: [], worldEvents: [] };
      }
      if (activeTournament.participants.length < MIN_TOURNAMENT_PLAYERS) {
        return { success: false, narrative: `Need at least ${MIN_TOURNAMENT_PLAYERS} participants. Currently: ${activeTournament.participants.length}`, stateChanges: [], worldEvents: [] };
      }
      
      // Finalize tier
      activeTournament.tier = getTournamentTier(activeTournament.participants.length);
      const tierConfig = activeTournament.tier ? TOURNAMENT_TIERS[activeTournament.tier] : null;
      
      // Calculate MON bonus based on tier (from treasury pool)
      if (tierConfig) {
        activeTournament.monBonus = getTournamentPool() * tierConfig.monShare;
      }
      
      activeTournament.bracket = generateBracket(activeTournament.participants, activeTournament.participantNames);
      activeTournament.totalRounds = Math.ceil(Math.log2(activeTournament.participants.length));
      activeTournament.currentRound = 1;
      activeTournament.status = 'active';
      
      const tierName = activeTournament.tier?.toUpperCase() || 'BRONZE';
      const monNote = activeTournament.monBonus > 0 ? ` + ${activeTournament.monBonus.toFixed(2)} MON` : '';
      
      logWorldEvent('tournament_start', `🏆 **${activeTournament.name} BEGINS!** ${tierName} TIER — ${activeTournament.participants.length} warriors compete for ${activeTournament.prizePool} Shells${monNote}!`, 'ring_of_barnacles', activeTournament.participants);
      
      // Start first match
      const firstMatch = startNextTournamentMatch();
      
      const rewardPreview = tierConfig ? `\n\n**${tierName} TIER REWARDS:**\n• ${EQUIPMENT[tierConfig.rewards.crown]?.name || tierConfig.rewards.crown}\n• ${EQUIPMENT[tierConfig.rewards.weapon]?.name || tierConfig.rewards.weapon}${tierConfig.rewards.armor ? `\n• ${EQUIPMENT[tierConfig.rewards.armor]?.name}` : ''}${monNote ? `\n• ${activeTournament.monBonus.toFixed(2)} MON` : ''}` : '';
      
      return {
        success: true,
        narrative: `🏆 **TOURNAMENT STARTED — ${tierName} TIER!**\n\n${activeTournament.participants.length} fighters\n${activeTournament.totalRounds} rounds\nPrize: ${activeTournament.prizePool} Shells${monNote}${rewardPreview}\n\n${firstMatch ? `⚔️ First match: ${firstMatch.agent1Name} vs ${firstMatch.agent2Name}!` : 'Preparing matches...'}`,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    // Tournament fight (if in active match)
    if (subcommand === 'fight' || params?.fight) {
      if (!activeTournament || activeTournament.status !== 'active') {
        return { success: false, narrative: `No active tournament.`, stateChanges: [], worldEvents: [] };
      }
      
      const myMatch = activeTournament.bracket.find(m => 
        m.status === 'active' && (m.agent1 === agentId || m.agent2 === agentId)
      );
      
      if (!myMatch) {
        return { success: false, narrative: `You're not in an active tournament match.`, stateChanges: [], worldEvents: [] };
      }
      
      const isAgent1 = myMatch.agent1 === agentId;
      const opponentId = isAgent1 ? myMatch.agent2! : myMatch.agent1!;
      const opponentName = activeTournament.participantNames.get(opponentId) || 'Unknown';
      
      // Calculate damage
      const baseDamage = 15 + Math.floor(Math.random() * 20);
      const { damage, isCrit } = calculateDamage(agentId, baseDamage);
      
      if (isAgent1) {
        myMatch.agent2Hp = Math.max(0, myMatch.agent2Hp - damage);
      } else {
        myMatch.agent1Hp = Math.max(0, myMatch.agent1Hp - damage);
      }
      
      const yourHp = isAgent1 ? myMatch.agent1Hp : myMatch.agent2Hp;
      const theirHp = isAgent1 ? myMatch.agent2Hp : myMatch.agent1Hp;
      
      let narrative = `⚔️ You strike **${opponentName}** for ${damage}!${isCrit ? ' **CRIT!**' : ''}\n`;
      narrative += `You: ${yourHp}/100 | Them: ${theirHp}/100\n`;
      
      // Check for KO
      if (myMatch.agent1Hp <= 0 || myMatch.agent2Hp <= 0) {
        myMatch.winner = myMatch.agent1Hp > 0 ? myMatch.agent1 : myMatch.agent2;
        myMatch.status = 'finished';
        
        const winnerName = activeTournament.participantNames.get(myMatch.winner!) || 'Unknown';
        const loserName = myMatch.winner === myMatch.agent1 
          ? activeTournament.participantNames.get(myMatch.agent2!) 
          : activeTournament.participantNames.get(myMatch.agent1!);
        
        const youWon = myMatch.winner === agentId;
        
        narrative += youWon 
          ? `\n🏆 **YOU WIN THE MATCH!** Advancing to next round!`
          : `\n💀 **ELIMINATED!** ${winnerName} advances.`;
        
        logWorldEvent('tournament_match_end', `🏆 ${winnerName} defeats ${loserName}! Advancing to Round ${activeTournament.currentRound + 1}!`, 'ring_of_barnacles', [myMatch.winner!]);
        
        // Check for round/tournament advancement
        advanceTournament();
        
        // Start next match if available
        const nextMatch = startNextTournamentMatch();
        if (nextMatch) {
          narrative += `\n\nNext match: ${nextMatch.agent1Name} vs ${nextMatch.agent2Name}`;
        }
      }
      
      return { success: true, narrative, stateChanges: [], worldEvents: [] };
    }
    
    // View tournament status
    if (!activeTournament) {
      return {
        success: true,
        narrative: `🏆 **Tournaments**\n\nNo active tournament.\n\nCreate one with: \`arena tournament=create fee=<shells> name="<name>"\`\n(Requires 100+ reputation)`,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    let tNarrative = `🏆 **${activeTournament.name}**\n\n`;
    tNarrative += `Status: ${activeTournament.status.toUpperCase()}\n`;
    tNarrative += `Prize Pool: ${activeTournament.prizePool} Shells\n`;
    tNarrative += `Participants: ${activeTournament.participants.length}\n`;
    
    if (activeTournament.status === 'registration') {
      tNarrative += `Entry Fee: ${activeTournament.entryFee} Shells\n\n`;
      tNarrative += `Join with: \`arena tournament=join\``;
    } else if (activeTournament.status === 'active') {
      tNarrative += `Round: ${activeTournament.currentRound}/${activeTournament.totalRounds}\n\n`;
      
      const activeMatch = activeTournament.bracket.find(m => m.status === 'active');
      if (activeMatch) {
        const a1 = activeTournament.participantNames.get(activeMatch.agent1!) || 'TBD';
        const a2 = activeTournament.participantNames.get(activeMatch.agent2!) || 'TBD';
        tNarrative += `**Current Match:** ${a1} (${activeMatch.agent1Hp}HP) vs ${a2} (${activeMatch.agent2Hp}HP)`;
      }
    } else if (activeTournament.status === 'finished') {
      tNarrative += `\n👑 **CHAMPION: ${activeTournament.championName}**`;
    }
    
    return { success: true, narrative: tNarrative, stateChanges: [], worldEvents: [] };
  }

  // View recent chat
  if (target === 'chat' || params?.view === 'chat') {
    if (arenaChat.length === 0) {
      return {
        success: true,
        narrative: `🏟️ **Arena Chat**\n\nNo messages yet. Be the first to talk trash!\n\n\`arena chat="your message"\``,
        stateChanges: [],
        worldEvents: [],
      };
    }
    
    let chatNarrative = `🏟️ **Arena Chat (Last 10)**\n\n`;
    for (const msg of arenaChat.slice(-10)) {
      chatNarrative += `**${msg.agentName}:** ${msg.message}\n`;
    }
    chatNarrative += `\n\`arena chat="message"\` to talk trash!`;
    
    return { success: true, narrative: chatNarrative, stateChanges: [], worldEvents: [] };
  }

  // Status / view duels
  let narrative = `🏟️ **RING OF BARNACLES**\n\n`;

  const myChallenge = pendingChallenges.get(agentId);
  if (myChallenge) {
    narrative += `⚔️ **Pending Challenge!**\n`;
    narrative += `${myChallenge.challengerName} challenges you! Wager: ${myChallenge.wager} Shells\n`;
    narrative += `\`arena accept\` or \`arena decline\`\n\n`;
  }

  let myDuel: ArenaDuel | null = null;
  for (const [, d] of activeDuels) {
    if (d.challenger === agentId || d.opponent === agentId) {
      myDuel = d;
      break;
    }
  }

  if (myDuel) {
    const isChallenger = agentId === myDuel.challenger;
    const yourHp = isChallenger ? myDuel.challengerHp : myDuel.opponentHp;
    const theirHp = isChallenger ? myDuel.opponentHp : myDuel.challengerHp;
    const theirName = isChallenger ? myDuel.opponentName : myDuel.challengerName;

    narrative += `⚔️ **Active Duel vs ${theirName}**\n`;
    narrative += `You: ${yourHp}/${myDuel.maxHp} | Them: ${theirHp}/${myDuel.maxHp}\n`;
    narrative += `Pot: ${myDuel.wager * 2} Shells\n`;
    narrative += myDuel.turn === agentId ? `**YOUR TURN!** \`arena strike\`\n\n` : `Waiting for ${theirName}...\n\n`;
  }

  // Show other active duels
  const otherDuels = Array.from(activeDuels.values()).filter(d => d.challenger !== agentId && d.opponent !== agentId);
  if (otherDuels.length > 0) {
    narrative += `**Active Duels:**\n`;
    for (const d of otherDuels) {
      narrative += `  ${d.challengerName} vs ${d.opponentName} — Pot: ${d.wager * 2} Shells\n`;
      narrative += `    Bet with: \`arena bet=${d.challenger}:<amount>\` or \`arena bet=${d.opponent}:<amount>\`\n`;
    }
    narrative += '\n';
  }

  if (!myChallenge && !myDuel && otherDuels.length === 0) {
    narrative += `The arena awaits challengers.\n\n`;
  }

  // Tournament info
  if (activeTournament) {
    narrative += `\n🏆 **Tournament: ${activeTournament.name}**\n`;
    narrative += `Status: ${activeTournament.status} | ${activeTournament.participants.length} fighters\n`;
    if (activeTournament.status === 'registration') {
      narrative += `\`arena tournament=join\` to enter (${activeTournament.entryFee} Shells)\n`;
    }
  }

  // Recent chat
  if (arenaChat.length > 0) {
    narrative += `\n💬 **Recent Chat:**\n`;
    for (const msg of arenaChat.slice(-3)) {
      narrative += `  ${msg.agentName}: "${msg.message}"\n`;
    }
  }

  narrative += `\n**Commands:**\n`;
  narrative += `  \`arena challenge=<agent> wager=<shells>\`\n`;
  narrative += `  \`arena bet=<agent>:<shells>\`\n`;
  narrative += `  \`arena chat="trash talk"\`\n`;
  narrative += `  \`arena tournament\` — View/join tournaments`;

  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Arena Chat (Spectator Trash Talk) ───
const arenaChat: Array<{ agentId: string; agentName: string; message: string; tick: number }> = [];
const MAX_ARENA_CHAT = 100;

function addArenaChat(agentId: string, agentName: string, message: string) {
  const tick = getTick();
  arenaChat.push({ agentId, agentName, message: message.slice(0, 200), tick });
  if (arenaChat.length > MAX_ARENA_CHAT) {
    arenaChat.shift();
  }
}

// ─── Tournament System ───
// Tournament tiers based on participant count
const TOURNAMENT_TIERS = {
  bronze: {
    minPlayers: 20,
    maxPlayers: 31,
    monShare: 0.10, // 10% of tournament pool
    rewards: {
      crown: 'bronze_crown',
      weapon: 'coral_dagger',
      armor: null,
    },
    title: 'Bronze Champion',
  },
  silver: {
    minPlayers: 32,
    maxPlayers: 63,
    monShare: 0.25, // 25% of tournament pool
    rewards: {
      crown: 'silver_crown',
      weapon: 'shark_fang_sword',
      armor: 'kelp_wrap',
    },
    title: 'Silver Champion',
  },
  gold: {
    minPlayers: 64,
    maxPlayers: 127,
    monShare: 0.50, // 50% of tournament pool
    rewards: {
      crown: 'gold_crown',
      weapon: 'leviathan_spine',
      armor: 'abyssal_carapace',
    },
    title: 'Gold Champion',
  },
  legendary: {
    minPlayers: 128,
    maxPlayers: Infinity,
    monShare: 1.0, // 100% of tournament pool
    rewards: {
      crown: 'void_crown',
      weapon: 'nullbane',
      armor: 'void_plate',
    },
    title: 'Legendary Champion',
  },
};

// Treasury pools now managed by services/treasury.ts
// - Entry fees split: 70% Leviathan, 20% Tournament, 10% Operations
// - Use getLeviathanPool(), getTournamentPool() for balances
// - Use distributeLeviathPool(), distributeTournamentPrize() for payouts

function getTournamentTier(playerCount: number): keyof typeof TOURNAMENT_TIERS | null {
  if (playerCount >= TOURNAMENT_TIERS.legendary.minPlayers) return 'legendary';
  if (playerCount >= TOURNAMENT_TIERS.gold.minPlayers) return 'gold';
  if (playerCount >= TOURNAMENT_TIERS.silver.minPlayers) return 'silver';
  if (playerCount >= TOURNAMENT_TIERS.bronze.minPlayers) return 'bronze';
  return null;
}

interface Tournament {
  id: string;
  name: string;
  status: 'registration' | 'active' | 'finished';
  entryFee: number;
  prizePool: number;
  monBonus: number; // MON kickback for champion
  tier: keyof typeof TOURNAMENT_TIERS | null;
  participants: string[]; // agentIds
  participantNames: Map<string, string>;
  bracket: Array<{
    round: number;
    matchIndex: number;
    agent1: string | null;
    agent2: string | null;
    winner: string | null;
    agent1Hp: number;
    agent2Hp: number;
    status: 'pending' | 'active' | 'finished';
  }>;
  currentRound: number;
  totalRounds: number;
  champion: string | null;
  championName: string | null;
  createdTick: number;
  registrationDeadline: number;
}

let activeTournament: Tournament | null = null;

const MIN_TOURNAMENT_PLAYERS = 20;

function generateBracket(participants: string[], participantNames: Map<string, string>): Tournament['bracket'] {
  const bracket: Tournament['bracket'] = [];
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  
  // Pad to power of 2
  let size = 1;
  while (size < shuffled.length) size *= 2;
  while (shuffled.length < size) shuffled.push('BYE');
  
  const totalRounds = Math.log2(size);
  let matchIndex = 0;
  
  // First round pairings
  for (let i = 0; i < shuffled.length; i += 2) {
    bracket.push({
      round: 1,
      matchIndex: matchIndex++,
      agent1: shuffled[i] === 'BYE' ? null : shuffled[i],
      agent2: shuffled[i + 1] === 'BYE' ? null : shuffled[i + 1],
      winner: null,
      agent1Hp: 100,
      agent2Hp: 100,
      status: 'pending',
    });
  }
  
  // Add placeholder matches for subsequent rounds
  let matchesInRound = size / 4;
  for (let round = 2; round <= totalRounds; round++) {
    for (let i = 0; i < matchesInRound; i++) {
      bracket.push({
        round,
        matchIndex: matchIndex++,
        agent1: null,
        agent2: null,
        winner: null,
        agent1Hp: 100,
        agent2Hp: 100,
        status: 'pending',
      });
    }
    matchesInRound /= 2;
  }
  
  // Handle BYE auto-advances
  for (const match of bracket.filter(m => m.round === 1)) {
    if (match.agent1 && !match.agent2) {
      match.winner = match.agent1;
      match.status = 'finished';
    } else if (match.agent2 && !match.agent1) {
      match.winner = match.agent2;
      match.status = 'finished';
    }
  }
  
  return bracket;
}

function advanceTournament() {
  if (!activeTournament || activeTournament.status !== 'active') return;
  
  const currentRoundMatches = activeTournament.bracket.filter(m => m.round === activeTournament!.currentRound);
  const allFinished = currentRoundMatches.every(m => m.status === 'finished');
  
  if (!allFinished) return;
  
  // Check if tournament is complete
  if (activeTournament.currentRound >= activeTournament.totalRounds) {
    const finalMatch = activeTournament.bracket.find(m => m.round === activeTournament!.totalRounds);
    if (finalMatch?.winner) {
      activeTournament.status = 'finished';
      activeTournament.champion = finalMatch.winner;
      activeTournament.championName = activeTournament.participantNames.get(finalMatch.winner) || 'Unknown';
      
      // Determine tier and rewards
      const tier = activeTournament.tier;
      const tierConfig = tier ? TOURNAMENT_TIERS[tier] : null;
      
      // Award prize
      const champion = getAgent(finalMatch.winner);
      if (champion) {
        // Shell prize
        const shellPrize = activeTournament.prizePool;
        updateAgent(finalMatch.winner, { shells: champion.shells + shellPrize });
        
        // MON prize (scaled by tier) - from treasury pool
        const tournamentPoolMon = getTournamentPool();
        const monPrize = tierConfig ? tournamentPoolMon * tierConfig.monShare : 0;
        
        // Execute MON payout if champion has wallet
        if (monPrize > 0 && champion.wallet) {
          distributeTournamentPrize(champion.wallet, activeTournament.participants.length)
            .then(result => {
              if (result.success) {
                console.log(`[Tournament] Paid ${result.amount} MON to ${champion.name} (tx: ${result.txHash})`);
              } else {
                console.error(`[Tournament] Payout failed: ${result.error}`);
              }
            })
            .catch(err => {
              console.error('[Tournament] Treasury payout error:', err);
            });
        }
        
        // Tier-based equipment rewards
        if (tierConfig) {
          if (tierConfig.rewards.crown) {
            addToInventory(finalMatch.winner, tierConfig.rewards.crown as ResourceType, 1);
          }
          if (tierConfig.rewards.weapon) {
            addToInventory(finalMatch.winner, tierConfig.rewards.weapon as ResourceType, 1);
          }
          if (tierConfig.rewards.armor) {
            addToInventory(finalMatch.winner, tierConfig.rewards.armor as ResourceType, 1);
          }
        }
        
        // Bonus materials based on tier
        if (tier === 'legendary') {
          addToInventory(finalMatch.winner, 'void_crystals', 5);
          addToInventory(finalMatch.winner, 'ancient_relic', 3);
        } else if (tier === 'gold') {
          addToInventory(finalMatch.winner, 'void_crystals', 3);
          addToInventory(finalMatch.winner, 'ancient_relic', 2);
        } else if (tier === 'silver') {
          addToInventory(finalMatch.winner, 'abyssal_pearls', 5);
          addToInventory(finalMatch.winner, 'moonstone', 3);
        } else {
          addToInventory(finalMatch.winner, 'moonstone', 2);
          addToInventory(finalMatch.winner, 'abyssal_pearls', 2);
        }
        
        const tierTitle = tierConfig?.title || 'Champion';
        const monNote = monPrize > 0 ? ` + ${monPrize.toFixed(2)} MON` : '';
        logWorldEvent('tournament_champion', `🏆👑 **${activeTournament.championName} IS THE ${tierTitle.toUpperCase()}!** Won ${shellPrize} Shells${monNote} + ${tier?.toUpperCase() || ''} Tier Rewards!`, 'ring_of_barnacles', [finalMatch.winner]);
      }
    }
    return;
  }
  
  // Advance to next round
  activeTournament.currentRound++;
  const nextRoundMatches = activeTournament.bracket.filter(m => m.round === activeTournament!.currentRound);
  const prevRoundWinners = currentRoundMatches.map(m => m.winner).filter(w => w !== null);
  
  // Populate next round matches
  for (let i = 0; i < nextRoundMatches.length; i++) {
    nextRoundMatches[i].agent1 = prevRoundWinners[i * 2] || null;
    nextRoundMatches[i].agent2 = prevRoundWinners[i * 2 + 1] || null;
    
    // Handle BYE
    if (nextRoundMatches[i].agent1 && !nextRoundMatches[i].agent2) {
      nextRoundMatches[i].winner = nextRoundMatches[i].agent1;
      nextRoundMatches[i].status = 'finished';
    } else if (nextRoundMatches[i].agent2 && !nextRoundMatches[i].agent1) {
      nextRoundMatches[i].winner = nextRoundMatches[i].agent2;
      nextRoundMatches[i].status = 'finished';
    }
  }
  
  logWorldEvent('tournament_round', `🏟️ Tournament Round ${activeTournament.currentRound} begins! ${nextRoundMatches.length} matches to fight!`, 'ring_of_barnacles', []);
}

function startNextTournamentMatch(): { match: Tournament['bracket'][0]; agent1Name: string; agent2Name: string } | null {
  if (!activeTournament || activeTournament.status !== 'active') return null;
  
  const pendingMatch = activeTournament.bracket.find(m => 
    m.round === activeTournament!.currentRound && 
    m.status === 'pending' && 
    m.agent1 && m.agent2
  );
  
  if (!pendingMatch) return null;
  
  pendingMatch.status = 'active';
  pendingMatch.agent1Hp = 100;
  pendingMatch.agent2Hp = 100;
  
  const agent1Name = activeTournament.participantNames.get(pendingMatch.agent1!) || 'Unknown';
  const agent2Name = activeTournament.participantNames.get(pendingMatch.agent2!) || 'Unknown';
  
  logWorldEvent('tournament_match', `⚔️ TOURNAMENT MATCH: ${agent1Name} vs ${agent2Name}!`, 'ring_of_barnacles', [pendingMatch.agent1!, pendingMatch.agent2!]);
  
  return { match: pendingMatch, agent1Name, agent2Name };
}

// Export arena state for API
export function getArenaState() {
  return {
    enabled: ARENA_ENABLED,
    activeDuels: Array.from(activeDuels.values()).map(d => ({
      id: d.id,
      challenger: d.challengerName,
      opponent: d.opponentName,
      challengerHp: d.challengerHp,
      opponentHp: d.opponentHp,
      maxHp: d.maxHp,
      pot: d.wager * 2,
      turn: d.turn === d.challenger ? d.challengerName : d.opponentName,
      betsCount: d.bets.size,
      status: d.status,
    })),
    pendingChallenges: Array.from(pendingChallenges.values()).map(d => ({
      challenger: d.challengerName,
      opponent: d.opponentName,
      wager: d.wager,
    })),
    chat: arenaChat.slice(-20),
    tournament: activeTournament ? {
      id: activeTournament.id,
      name: activeTournament.name,
      status: activeTournament.status,
      tier: activeTournament.tier?.toUpperCase() || (activeTournament.participants.length >= 20 ? getTournamentTier(activeTournament.participants.length)?.toUpperCase() : 'NONE'),
      entryFee: activeTournament.entryFee,
      prizePool: activeTournament.prizePool,
      monBonus: activeTournament.monBonus,
      participantCount: activeTournament.participants.length,
      minPlayers: MIN_TOURNAMENT_PLAYERS,
      currentRound: activeTournament.currentRound,
      totalRounds: activeTournament.totalRounds,
      champion: activeTournament.championName,
      nextTierAt: activeTournament.participants.length < 20 ? 20 
        : activeTournament.participants.length < 32 ? 32 
        : activeTournament.participants.length < 64 ? 64 
        : activeTournament.participants.length < 128 ? 128 : null,
      bracket: activeTournament.bracket.map(m => ({
        round: m.round,
        agent1: m.agent1 ? activeTournament!.participantNames.get(m.agent1) || 'BYE' : 'TBD',
        agent2: m.agent2 ? activeTournament!.participantNames.get(m.agent2) || 'BYE' : 'TBD',
        winner: m.winner ? activeTournament!.participantNames.get(m.winner) : null,
        status: m.status,
        agent1Hp: m.agent1Hp,
        agent2Hp: m.agent2Hp,
      })),
    } : null,
    tiers: TOURNAMENT_TIERS,
  };
}

// ─── Encounter Combat ───
function handleEncounterCombat(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;
  const encounter = activeEncounters.get(agentId);
  
  if (!encounter) {
    return {
      success: false,
      narrative: "You're not in combat with anything.",
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < GAME.ENERGY_PER_ATTACK) {
    return {
      success: false,
      narrative: `Not enough energy to attack. Need ${GAME.ENERGY_PER_ATTACK}, have ${agent.energy}.\n\n⚔️ You can still \`flee\` to escape.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Calculate player damage (with faction bonuses)
  const baseDamage = GAME.BASE_ATTACK_DAMAGE + Math.floor(Math.random() * 10);
  const { damage: playerDamage, isCrit } = calculateDamage(agentId, baseDamage);
  
  // Apply damage to mob
  encounter.mobHp = Math.max(0, encounter.mobHp - playerDamage);
  
  // Mob hits back (reduced by armor)
  const rawMobDamage = encounter.mobDamage + Math.floor(Math.random() * 5);
  const damageReduction = calculateDamageReduction(agentId);
  const mobDamage = Math.max(1, rawMobDamage - damageReduction);
  const newHp = Math.max(0, agent.hp - mobDamage);
  
  updateAgent(agentId, {
    hp: newHp,
    energy: agent.energy - GAME.ENERGY_PER_ATTACK,
  });

  const critText = isCrit ? ' **CRITICAL HIT!**' : '';
  let narrative = `⚔️ You strike **${encounter.mob.name}** for ${playerDamage} damage!${critText}\n`;
  narrative += `🐙 ${encounter.mob.name}: ${encounter.mobHp}/${encounter.mobMaxHp} HP\n\n`;
  narrative += `${encounter.mob.name} retaliates for ${mobDamage} damage!\n`;
  narrative += `❤️ Your HP: ${newHp}/${agent.maxHp}\n`;
  narrative += `⚡ Energy: ${agent.energy - GAME.ENERGY_PER_ATTACK}/${agent.maxEnergy}`;

  // Check if mob died
  if (encounter.mobHp <= 0) {
    narrative += `\n\n🎉 **VICTORY!** ${encounter.mob.deathText}`;
    
    // Grant XP and shells (XP scales with level difference)
    const xpResult = grantMobKillXp(agentId, encounter.mob.xpReward, encounter.mob.minLevel);
    const shellsEarned = grantShells(agentId, encounter.mob.shellReward, 'mob_kill');
    
    narrative += `\n\n**Rewards:**`;
    narrative += xpResult.scaled 
      ? `\n⭐ +${xpResult.xpGained} XP *(reduced - mob too weak)*`
      : `\n⭐ +${xpResult.xpGained} XP`;
    narrative += `\n🐚 +${shellsEarned} Shells`;
    
    if (xpResult.leveledUp) {
      narrative += `\n\n🎉 **LEVEL UP!** You're now Level ${xpResult.newLevel}!`;
    }
    
    // Roll loot
    const lootDropped: string[] = [];
    for (const loot of encounter.mob.lootTable) {
      if (Math.random() < loot.chance) {
        const amount = loot.min + Math.floor(Math.random() * (loot.max - loot.min + 1));
        if (getInventoryCount(agentId) < agent.inventorySlots) {
          addToInventory(agentId, loot.resource, amount);
          lootDropped.push(`${amount}x ${RESOURCE_INFO[loot.resource].name}`);
        } else {
          narrative += `\n⚠️ Inventory full! ${amount}x ${RESOURCE_INFO[loot.resource].name} lost.`;
        }
      }
    }
    
    if (lootDropped.length > 0) {
      narrative += `\n💰 Loot: ${lootDropped.join(', ')}`;
    }
    
    // If this was a resource guardian, agent can now gather the resource
    if (encounter.isResourceGuardian && encounter.guardedResource) {
      markGuardianKilled(agentId, encounter.guardedResource, encounter.zone);
      narrative += `\n\n✨ The ${RESOURCE_INFO[encounter.guardedResource].name} is now unguarded! Use \`gather ${encounter.guardedResource}\` to collect it.`;
    } else {
      // Complete the move if this was a travel encounter
      const currentLoc = agent.location;
      if (encounter.zone !== currentLoc) {
        updateAgent(agentId, { location: encounter.zone });
        const dest = LOCATIONS[encounter.zone];
        narrative += `\n\n🏊 You continue on to **${dest.name}**.\n\n${dest.description}`;
        logWorldEvent('agent_moved', `${agent.name} defeated a ${encounter.mob.name} and reached ${dest.name}.`, encounter.zone, [agentId]);
      }
    }
    
    logWorldEvent('mob_killed', `${agent.name} defeated a ${encounter.mob.name}!`, agent.location, [agentId]);
    endEncounter(agentId);
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // Check if player died
  if (newHp <= 0) {
    endEncounter(agentId);
    const { shellsLost, deathCount } = handleDeath(agentId, `was killed by a ${encounter.mob.name}`);
    
    narrative += `\n\n💀 **DEFEATED!** ${encounter.mob.name} overwhelms you. You black out and wake at The Shallows.`;
    narrative += ` (Deaths: ${deathCount}, Lost ${shellsLost}🐚)`;
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // Combat continues
  narrative += `\n\n**Options:**\n• \`attack\` — Continue fighting\n• \`flee\` — Escape (takes damage)`;
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Flee from Encounter ───
function handleFlee(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;
  
  // Check for PvP engagement first
  if (getEngagement(agentId)) {
    return handlePvPFlee(agentId);
  }
  
  const encounter = activeEncounters.get(agentId);
  
  if (!encounter) {
    return {
      success: false,
      narrative: "You're not in combat. Nothing to flee from.",
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Take flee damage (50% of mob's damage, reduced by armor)
  const rawFleeDamage = Math.floor(encounter.mobDamage * 0.5) + Math.floor(Math.random() * 5);
  const damageReduction = calculateDamageReduction(agentId);
  const fleeDamage = Math.max(1, rawFleeDamage - damageReduction);
  const newHp = Math.max(0, agent.hp - fleeDamage);
  
  updateAgent(agentId, { hp: newHp });
  
  let narrative = `🏃 You turn and flee from the **${encounter.mob.name}**!\n\n`;
  narrative += `It strikes your back as you escape for ${fleeDamage} damage!\n`;
  narrative += `❤️ HP: ${newHp}/${agent.maxHp}`;
  
  if (newHp <= 0) {
    endEncounter(agentId);
    const { shellsLost, deathCount } = handleDeath(agentId, `was killed while fleeing from a ${encounter.mob.name}`);
    narrative += `\n\n💀 The blow was fatal. You black out and wake at The Shallows. (Deaths: ${deathCount}, Lost ${shellsLost}🐚)`;
  } else {
    endEncounter(agentId);
    const currentLoc = LOCATIONS[agent.location];
    
    if (encounter.isResourceGuardian) {
      narrative += `\n\nYou abandon your attempt to gather the ${encounter.guardedResource ? RESOURCE_INFO[encounter.guardedResource].name : 'resource'}.`;
    } else {
      narrative += `\n\nYou retreat, staying in **${currentLoc.name}**.`;
    }
    
    logWorldEvent('fled_encounter', `${agent.name} fled from a ${encounter.mob.name}.`, agent.location, [agentId]);
  }
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Look at Current Encounter ───
function handleEncounterLook(agentId: string, encounter: ActiveEncounter): ActionResult {
  const agent = getAgent(agentId)!;
  
  const typeLabel = encounter.isResourceGuardian 
    ? `Resource Guardian (protecting ${encounter.guardedResource ? RESOURCE_INFO[encounter.guardedResource].name : 'treasure'})`
    : 'Hostile Creature';
  
  let narrative = `⚔️ **IN COMBAT**\n\n`;
  narrative += `**Enemy:** ${encounter.mob.name} (${typeLabel})\n`;
  narrative += `🐙 HP: ${encounter.mobHp}/${encounter.mobMaxHp}\n`;
  narrative += `⚔️ Damage: ~${encounter.mobDamage}\n\n`;
  narrative += `_${encounter.mob.flavorText}_\n\n`;
  narrative += `**Your Status:**\n`;
  narrative += `❤️ HP: ${agent.hp}/${agent.maxHp}\n`;
  narrative += `⚡ Energy: ${agent.energy}/${agent.maxEnergy}\n\n`;
  narrative += `**Options:**\n`;
  narrative += `• \`attack\` — Strike the enemy\n`;
  narrative += `• \`flee\` — Escape (takes damage)`;
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Drop Item ───
function handleDrop(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const inv = getInventory(agentId);
  
  if (inv.length === 0) {
    return {
      success: false,
      narrative: 'Your inventory is empty. Nothing to drop.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  if (!target) {
    let narrative = '🎒 **Your Inventory:**\n';
    for (const item of inv) {
      narrative += `  • ${RESOURCE_INFO[item.resource]?.name || item.resource} x${item.quantity}\n`;
    }
    narrative += `\n**To drop:** \`drop <resource>\` or \`drop <resource>:<quantity>\``;
    narrative += `\nExample: \`drop seaweed:5\` or \`drop seaweed\` (drops all)`;
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // Parse target (resource:quantity or just resource)
  // Also support params.quantity
  let resource: ResourceType;
  let quantity: number;
  
  if (target.includes(':')) {
    const [res, qty] = target.split(':');
    resource = res as ResourceType;
    quantity = parseInt(qty || '1', 10);
  } else if (params?.quantity) {
    resource = target as ResourceType;
    quantity = parseInt(params.quantity, 10);
  } else {
    resource = target as ResourceType;
    const item = inv.find(i => i.resource === resource);
    quantity = item?.quantity || 0; // Drop all if no quantity specified
  }
  
  if (quantity <= 0) {
    return { success: false, narrative: 'Invalid quantity.', stateChanges: [], worldEvents: [] };
  }
  
  const item = inv.find(i => i.resource === resource);
  if (!item || item.quantity < quantity) {
    return {
      success: false,
      narrative: `You don't have ${quantity}x ${RESOURCE_INFO[resource]?.name || resource} to drop.`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  removeFromInventory(agentId, resource, quantity);
  
  const narrative = `🗑️ You drop ${quantity}x **${RESOURCE_INFO[resource]?.name || resource}**.\n\nThe items sink into the depths, lost forever.`;
  
  logWorldEvent('item_dropped', `${agent.name} dropped ${quantity}x ${RESOURCE_INFO[resource]?.name || resource}.`, agent.location, [agentId]);
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Active Buffs (in-memory) ───
const activeBuffs = new Map<string, Array<{ type: string; value: number; expiresAt: number }>>();

export function getActiveBuffs(agentId: string, currentTick: number): Array<{ type: string; value: number }> {
  const buffs = activeBuffs.get(agentId) || [];
  // Filter out expired buffs
  const active = buffs.filter(b => b.expiresAt > currentTick);
  activeBuffs.set(agentId, active);
  return active.map(b => ({ type: b.type, value: b.value }));
}

function addBuff(agentId: string, type: string, value: number, duration: number): void {
  const currentTick = getTick();
  const buffs = activeBuffs.get(agentId) || [];
  buffs.push({ type, value, expiresAt: currentTick + duration });
  activeBuffs.set(agentId, buffs);
}

function hasBuff(agentId: string, type: string): boolean {
  const buffs = getActiveBuffs(agentId, getTick());
  return buffs.some(b => b.type === type);
}

// ─── Shop Handler ───
function handleShop(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  
  // Shop is at Trading Post
  const merchant = loc.npcs.find(n => n.type === 'merchant');
  if (!merchant) {
    return {
      success: false,
      narrative: 'No shop here. Visit the Trading Post to buy equipment and consumables.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  let narrative = `🏪 **${merchant.name}'s Shop**\n\n🐚 Your Shells: ${agent.shells}\n\n`;
  
  // Show featured item (hourly special)
  const featured = getCurrentFeaturedItem();
  if (featured.item && featured.stock > 0) {
    narrative += `⭐ **HOURLY SPECIAL** (${featured.minutesRemaining}m left):\n`;
    narrative += `  • **${featured.item.name}** [featured] — ${featured.item.price}🐚 (${featured.stock} left!)\n`;
    narrative += `    _${featured.item.description}_\n\n`;
  } else if (featured.item) {
    narrative += `⭐ **HOURLY SPECIAL**: SOLD OUT! Next item in ${featured.minutesRemaining}m\n\n`;
  }
  
  // Show consumables
  if (!target || target === 'consumables') {
    narrative += '**🧪 Consumables:**\n';
    for (const [id, item] of Object.entries(CONSUMABLES)) {
      narrative += `  • **${item.name}** [${id}] — ${item.price}🐚\n`;
      narrative += `    _${item.description}_\n`;
    }
    narrative += '\n';
  }
  
  // Show equipment
  if (!target || target === 'equipment') {
    narrative += '**⚔️ Equipment:**\n';
    for (const [id, item] of Object.entries(SHOP_EQUIPMENT)) {
      const statsText = Object.entries(item.stats)
        .map(([k, v]) => `+${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
        .join(', ');
      narrative += `  • **${item.name}** [${id}] — ${item.price}🐚 (${item.rarity})\n`;
      narrative += `    ${item.slot}: ${statsText}\n`;
    }
    narrative += '\n';
  }
  
  // Show inventory expansion
  if (!target || target === 'upgrades') {
    const canBuySlots = agent.inventorySlots < INVENTORY_CONFIG.maxSlots;
    narrative += '**📦 Upgrades:**\n';
    if (canBuySlots) {
      narrative += `  • **Inventory Slot** [inv_slot] — ${INVENTORY_CONFIG.pricePerSlot}🐚\n`;
      narrative += `    Current: ${agent.inventorySlots}/${INVENTORY_CONFIG.maxSlots} slots\n`;
    } else {
      narrative += `  • Inventory: MAX (${agent.inventorySlots} slots)\n`;
    }
    
    const vaultPrice = getVaultSlotPrice(agent.vaultSlots || 0);
    narrative += `  • **Vault Slot** [vault_slot] — ${vaultPrice}🐚\n`;
    narrative += `    Current: ${agent.vaultSlots || 0}/${VAULT_CONFIG.maxSlots} vault slots\n`;
  }
  
  narrative += '\n**To buy:** `buy <item_id>`\n';
  narrative += 'Example: `buy seaweed_salve` or `buy shell_blade`';
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Buy Handler ───
function handleBuy(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  
  const merchant = loc.npcs.find(n => n.type === 'merchant');
  if (!merchant) {
    return {
      success: false,
      narrative: 'No shop here. Visit the Trading Post.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  if (!target) {
    return {
      success: false,
      narrative: 'What do you want to buy? Use `shop` to see available items, then `buy <item_id>`.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check for inventory slot purchase
  if (target === 'inv_slot' || target === 'inventory_slot') {
    if (agent.inventorySlots >= INVENTORY_CONFIG.maxSlots) {
      return { success: false, narrative: `Inventory already at max (${INVENTORY_CONFIG.maxSlots} slots).`, stateChanges: [], worldEvents: [] };
    }
    if (agent.shells < INVENTORY_CONFIG.pricePerSlot) {
      return { success: false, narrative: `Not enough Shells. Need ${INVENTORY_CONFIG.pricePerSlot}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }
    
    updateAgent(agentId, {
      shells: agent.shells - INVENTORY_CONFIG.pricePerSlot,
      inventorySlots: agent.inventorySlots + 1,
    });
    
    return {
      success: true,
      narrative: `📦 Purchased inventory slot!\n\n**Inventory:** ${agent.inventorySlots + 1}/${INVENTORY_CONFIG.maxSlots} slots\n🐚 Shells: ${agent.shells - INVENTORY_CONFIG.pricePerSlot}`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check for vault slot purchase
  if (target === 'vault_slot') {
    const currentVault = agent.vaultSlots || 0;
    if (currentVault >= VAULT_CONFIG.maxSlots) {
      return { success: false, narrative: `Vault already at max (${VAULT_CONFIG.maxSlots} slots).`, stateChanges: [], worldEvents: [] };
    }
    
    const price = getVaultSlotPrice(currentVault);
    if (agent.shells < price) {
      return { success: false, narrative: `Not enough Shells. Need ${price}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }
    
    updateAgent(agentId, {
      shells: agent.shells - price,
      vaultSlots: currentVault + 1,
    });
    
    const nextPrice = getVaultSlotPrice(currentVault + 1);
    return {
      success: true,
      narrative: `🏦 Purchased vault slot!\n\n**Vault:** ${currentVault + 1}/${VAULT_CONFIG.maxSlots} slots\n🐚 Shells: ${agent.shells - price}\n\n_Next slot costs ${nextPrice}🐚_`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check featured item (hourly special)
  if (target === 'featured' || target === 'special' || target === 'hourly') {
    const featured = getCurrentFeaturedItem();
    if (!featured.item) {
      return { success: false, narrative: 'No featured item available right now.', stateChanges: [], worldEvents: [] };
    }
    if (featured.stock <= 0) {
      return { success: false, narrative: `⭐ **${featured.item.name}** is SOLD OUT! Next item in ${featured.minutesRemaining}m.`, stateChanges: [], worldEvents: [] };
    }
    if (agent.shells < featured.item.price) {
      return { success: false, narrative: `Not enough Shells. Need ${featured.item.price}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }
    
    const result = buyFeaturedItem();
    if (!result.success || !result.item) {
      return { success: false, narrative: result.error || 'Failed to buy featured item.', stateChanges: [], worldEvents: [] };
    }
    
    updateAgent(agentId, { shells: agent.shells - result.item.price });
    
    // Apply featured item effect
    let effectText = '';
    if (result.item.effect) {
      switch (result.item.effect.type) {
        case 'instant_xp':
          grantXp(agentId, result.item.effect.value, 'featured_item');
          effectText = `⭐ Gained ${result.item.effect.value} XP!`;
          break;
        case 'shell_reward':
          const reward = 100 + Math.floor(Math.random() * 200);
          grantShells(agentId, reward, 'treasure_map');
          effectText = `💰 Found a treasure cache with ${reward} Shells!`;
          break;
        case 'full_heal':
          updateAgent(agentId, { hp: agent.maxHp });
          effectText = `❤️ Fully healed to ${agent.maxHp} HP!`;
          break;
        default:
          effectText = `Effect: ${result.item.description}`;
      }
    }
    
    logWorldEvent('featured_purchase', `⭐ ${agent.name} snagged the hourly special: ${result.item.name}!`, agent.location, [agentId]);
    
    return {
      success: true,
      narrative: `⭐ **Purchased: ${result.item.name}!**\n\n${effectText}\n\n🐚 Shells: ${agent.shells - result.item.price}`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check consumables - add to inventory for later use
  const consumable = CONSUMABLES[target];
  if (consumable) {
    if (agent.shells < consumable.price) {
      return { success: false, narrative: `Not enough Shells. Need ${consumable.price}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }
    
    updateAgent(agentId, { shells: agent.shells - consumable.price });
    addToInventory(agentId, target as ResourceType, 1);
    
    logWorldEvent('purchase', `${agent.name} bought ${consumable.name} for ${consumable.price} Shells.`, agent.location, [agentId]);
    
    return {
      success: true,
      narrative: `🧪 Purchased **${consumable.name}**!\n\nAdded to inventory. Use with \`use ${target}\` when needed.\n\n🐚 Shells: ${agent.shells - consumable.price}`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check equipment
  const equipment = SHOP_EQUIPMENT[target];
  if (equipment) {
    if (agent.shells < equipment.price) {
      return { success: false, narrative: `Not enough Shells. Need ${equipment.price}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
    }
    
    if (getInventoryCount(agentId) >= agent.inventorySlots) {
      return { success: false, narrative: 'Inventory full! Drop or store items first.', stateChanges: [], worldEvents: [] };
    }
    
    updateAgent(agentId, { shells: agent.shells - equipment.price });
    addToInventory(agentId, target as ResourceType, 1);
    
    logWorldEvent('purchase', `${agent.name} bought ${equipment.name} for ${equipment.price} Shells.`, agent.location, [agentId]);
    
    const statsText = Object.entries(equipment.stats)
      .map(([k, v]) => `+${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
      .join(', ');
    
    return {
      success: true,
      narrative: `⚔️ Purchased **${equipment.name}**!\n\n${equipment.slot}: ${statsText}\n_${equipment.description}_\n\n🐚 Shells: ${agent.shells - equipment.price}\n\n_Equip with \`use ${target}\`_`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  return { success: false, narrative: `Item "${target}" not found. Use \`shop\` to see available items.`, stateChanges: [], worldEvents: [] };
}

// ─── Craft Handler ───
function handleCraft(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  
  // Can only craft at Trading Post (has workbenches)
  if (agent.location !== 'trading_post') {
    return {
      success: false,
      narrative: '🔨 Crafting requires the workbenches at the Trading Post. Travel there first.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Show available recipes if no target
  if (!target || target === 'list') {
    let narrative = '🔨 **CRAFTING RECIPES**\n\n';
    narrative += '_Craft powerful equipment from gathered resources!_\n\n';
    
    const inv = getInventory(agentId);
    const invMap = new Map(inv.map(i => [i.resource, i.quantity]));
    
    for (const recipe of CRAFTING_RECIPES) {
      const canCraft = agent.level >= recipe.levelRequired && 
        recipe.ingredients.every(ing => (invMap.get(ing.resource) || 0) >= ing.amount);
      
      const resultItem = EQUIPMENT[recipe.result.id];
      const statusIcon = canCraft ? '✅' : (agent.level < recipe.levelRequired ? '🔒' : '❌');
      
      narrative += `${statusIcon} **${recipe.id}** → ${resultItem?.name || recipe.result.id}\n`;
      narrative += `   Level ${recipe.levelRequired}+ | `;
      narrative += recipe.ingredients.map(ing => {
        const have = invMap.get(ing.resource) || 0;
        const need = ing.amount;
        const status = have >= need ? '✓' : `${have}/${need}`;
        return `${RESOURCE_INFO[ing.resource]?.name || ing.resource}: ${status}`;
      }).join(', ');
      narrative += '\n\n';
    }
    
    narrative += '_Craft: `{"action": "craft", "target": "craft_shell_blade"}`_';
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // Find recipe
  const recipe = CRAFTING_RECIPES.find(r => r.id === target || r.id === `craft_${target}`);
  if (!recipe) {
    return {
      success: false,
      narrative: `Recipe "${target}" not found. Use \`craft list\` to see available recipes.`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check level requirement
  if (agent.level < recipe.levelRequired) {
    return {
      success: false,
      narrative: `🔒 **${recipe.name}** requires Level ${recipe.levelRequired}. You are Level ${agent.level}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check ingredients
  const inv = getInventory(agentId);
  const invMap = new Map(inv.map(i => [i.resource, i.quantity]));
  const missing: string[] = [];
  
  for (const ing of recipe.ingredients) {
    const have = invMap.get(ing.resource) || 0;
    if (have < ing.amount) {
      missing.push(`${RESOURCE_INFO[ing.resource]?.name || ing.resource}: need ${ing.amount}, have ${have}`);
    }
  }
  
  if (missing.length > 0) {
    return {
      success: false,
      narrative: `❌ **Missing materials for ${recipe.name}:**\n\n${missing.join('\n')}\n\n_Gather resources from the world or buy from other agents._`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Check inventory space
  if (getInventoryCount(agentId) >= agent.inventorySlots) {
    return {
      success: false,
      narrative: 'Inventory full! Drop or store items first.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Consume ingredients
  for (const ing of recipe.ingredients) {
    removeFromInventory(agentId, ing.resource, ing.amount);
  }
  
  // Create result item
  addToInventory(agentId, recipe.result.id as ResourceType, 1);
  
  const resultItem = EQUIPMENT[recipe.result.id];
  const statsText = resultItem?.stats 
    ? Object.entries(resultItem.stats).map(([k, v]) => `+${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(', ')
    : '';
  
  logWorldEvent('craft', `🔨 ${agent.name} crafted ${resultItem?.name || recipe.result.id}!`, agent.location, [agentId]);
  
  let narrative = `🔨 **CRAFTED: ${resultItem?.name || recipe.result.id}!**\n\n`;
  if (resultItem) {
    narrative += `${resultItem.slot}: ${statsText}\n`;
    narrative += `Rarity: ${resultItem.rarity}\n\n`;
  }
  narrative += `**Materials consumed:**\n`;
  for (const ing of recipe.ingredients) {
    narrative += `  • ${ing.amount}x ${RESOURCE_INFO[ing.resource]?.name || ing.resource}\n`;
  }
  narrative += `\n_Equip with \`use ${recipe.result.id}\`_`;
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Sell Handler ───
// Sell prices are 40% of base value for resources
const SELL_PRICES: Record<string, number> = {
  seaweed: 1,
  sand_dollars: 1,
  coral_shards: 3,
  sea_glass: 2,
  pearl: 8,
  moonstone: 10,
  kelp_fiber: 2,
  ink_sacs: 4,
  shark_tooth: 6,
  iron_barnacles: 3,
  abyssal_pearls: 15,
  void_crystals: 25,
  biolume_essence: 8,
  ancient_relic: 20,
};

function handleSell(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  
  if (agent.location !== 'trading_post') {
    return {
      success: false,
      narrative: '🏪 You must be at the Trading Post to sell items.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  const inv = getInventory(agentId);
  
  if (!target) {
    let narrative = '💰 **Sell Items** (at Trading Post)\n\n';
    narrative += '**Your Inventory:**\n';
    for (const item of inv) {
      const price = SELL_PRICES[item.resource] || 1;
      narrative += `  • ${RESOURCE_INFO[item.resource]?.name || item.resource} x${item.quantity} → ${price}🐚 each\n`;
    }
    narrative += '\n**To sell:** `sell <resource>` or `sell <resource>:<quantity>`\n';
    narrative += 'Example: `sell seaweed:5` or `sell seaweed` (sells all)';
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // Parse target (resource:quantity or just resource)
  let resource: ResourceType;
  let quantity: number;
  
  if (target.includes(':')) {
    const [res, qty] = target.split(':');
    resource = res as ResourceType;
    quantity = parseInt(qty || '1', 10);
  } else if (params?.quantity) {
    resource = target as ResourceType;
    quantity = parseInt(params.quantity, 10);
  } else {
    resource = target as ResourceType;
    const item = inv.find(i => i.resource === resource);
    quantity = item?.quantity || 0; // Sell all if no quantity specified
  }
  
  if (quantity <= 0) {
    return { success: false, narrative: 'Invalid quantity.', stateChanges: [], worldEvents: [] };
  }
  
  const item = inv.find(i => i.resource === resource);
  if (!item || item.quantity < quantity) {
    return {
      success: false,
      narrative: `You don't have ${quantity}x ${RESOURCE_INFO[resource]?.name || resource} to sell.`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  const pricePerUnit = SELL_PRICES[resource] || 1;
  const totalShells = pricePerUnit * quantity;
  
  removeFromInventory(agentId, resource, quantity);
  updateAgent(agentId, { shells: agent.shells + totalShells });
  
  const narrative = `💰 Sold ${quantity}x **${RESOURCE_INFO[resource]?.name || resource}** for **${totalShells}🐚**!\n\n🐚 Shells: ${agent.shells + totalShells}`;
  
  logWorldEvent('item_sold', `${agent.name} sold ${quantity}x ${RESOURCE_INFO[resource]?.name || resource} for ${totalShells} Shells.`, agent.location, [agentId]);
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Fast Travel Handler ───
function handleTravel(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const visitedZones: LocationId[] = agent.visitedZones || ['shallows'];
  
  if (!target) {
    const routes = getAvailableRoutes(agent.location);
    
    let narrative = `🌊 **Current Network — Fast Travel**\n\n`;
    narrative += `📍 Current location: ${LOCATIONS[agent.location].name}\n`;
    narrative += `🐚 Shells: ${agent.shells}\n\n`;
    
    if (routes.length === 0) {
      narrative += '_No currents available from this location._\n';
    } else {
      narrative += '**Available Currents:**\n';
      for (const route of routes) {
        const visited = visitedZones.includes(route.to);
        const canTravel = visited ? '✅' : '🔒';
        narrative += `  ${canTravel} **${LOCATIONS[route.to].name}** — ${route.cost}🐚 (${route.name})\n`;
        if (!visited) {
          narrative += `    _Visit this zone first to unlock_\n`;
        }
      }
    }
    
    narrative += `\n**To travel:** \`travel <zone_id>\``;
    narrative += `\nExample: \`travel trading_post\``;
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  const destination = target as LocationId;
  if (!LOCATIONS[destination]) {
    return { success: false, narrative: `Unknown destination: ${target}`, stateChanges: [], worldEvents: [] };
  }
  
  // Check if route exists
  const route = CURRENT_ROUTES.find(r => r.from === agent.location && r.to === destination);
  if (!route) {
    return { success: false, narrative: `No current connects ${LOCATIONS[agent.location].name} to ${LOCATIONS[destination].name}.`, stateChanges: [], worldEvents: [] };
  }
  
  // Check if visited
  if (!visitedZones.includes(destination)) {
    return { success: false, narrative: `You haven't discovered ${LOCATIONS[destination].name} yet. Visit it by swimming there first.`, stateChanges: [], worldEvents: [] };
  }
  
  // Check cost
  if (agent.shells < route.cost) {
    return { success: false, narrative: `Not enough Shells. Need ${route.cost}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
  }
  
  // Fast travel - no encounters!
  updateAgent(agentId, {
    shells: agent.shells - route.cost,
    location: destination,
    isHidden: false,
  });
  
  const dest = LOCATIONS[destination];
  logWorldEvent('fast_travel', `${agent.name} rode the ${route.name} to ${dest.name}.`, destination, [agentId]);
  
  return {
    success: true,
    narrative: `🌊 You ride the **${route.name}** current...\n\n📍 Arrived at **${dest.name}**!\n\n${dest.description}\n\n🐚 Shells: ${agent.shells - route.cost}`,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── Vault Handler (Trading Post only) ───
function handleVault(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  
  if (agent.location !== 'trading_post') {
    return { success: false, narrative: 'The vault is at the Trading Post. Travel there to access your stored items.', stateChanges: [], worldEvents: [] };
  }
  
  const vaultSlots = agent.vaultSlots || 0;
  const vaultContents = getVaultContents(agentId);
  const vaultUsed = vaultContents.reduce((sum, item) => sum + item.quantity, 0);
  
  if (vaultSlots === 0 && !target) {
    return {
      success: true,
      narrative: `🏦 **The Vault**\n\nYou don't have any vault slots yet.\n\n**To buy slots:** \`buy vault_slot\`\nFirst slot costs ${getVaultSlotPrice(0)}🐚`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Deposit items
  if (target === 'deposit' && params?.item) {
    const [resource, qtyStr] = params.item.includes(':') ? params.item.split(':') : [params.item, '1'];
    const quantity = parseInt(qtyStr, 10);
    
    if (vaultUsed + quantity > vaultSlots) {
      return { success: false, narrative: `Vault full! Have ${vaultUsed}/${vaultSlots} items stored. Buy more slots.`, stateChanges: [], worldEvents: [] };
    }
    
    if (!removeFromInventory(agentId, resource as ResourceType, quantity)) {
      return { success: false, narrative: `You don't have ${quantity}x ${resource} to deposit.`, stateChanges: [], worldEvents: [] };
    }
    
    addToVault(agentId, resource as ResourceType, quantity);
    return {
      success: true,
      narrative: `🏦 Deposited ${quantity}x **${RESOURCE_INFO[resource as ResourceType]?.name || resource}** to vault.\n\n📦 Vault: ${vaultUsed + quantity}/${vaultSlots} slots used`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Withdraw items
  if (target === 'withdraw' && params?.item) {
    const [resource, qtyStr] = params.item.includes(':') ? params.item.split(':') : [params.item, '1'];
    const quantity = parseInt(qtyStr, 10);
    
    if (!removeFromVault(agentId, resource as ResourceType, quantity)) {
      return { success: false, narrative: `You don't have ${quantity}x ${resource} in your vault.`, stateChanges: [], worldEvents: [] };
    }
    
    const inv = getInventory(agentId);
    const invCount = inv.reduce((sum, i) => sum + i.quantity, 0);
    if (invCount + quantity > agent.inventorySlots) {
      // Put it back
      addToVault(agentId, resource as ResourceType, quantity);
      return { success: false, narrative: `Inventory full! Make room first.`, stateChanges: [], worldEvents: [] };
    }
    
    addToInventory(agentId, resource as ResourceType, quantity);
    return {
      success: true,
      narrative: `🏦 Withdrew ${quantity}x **${RESOURCE_INFO[resource as ResourceType]?.name || resource}** from vault.\n\n📦 Vault: ${vaultUsed - quantity}/${vaultSlots} slots used`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Show vault contents
  let narrative = `🏦 **Your Vault**\n\n`;
  narrative += `📦 Slots: ${vaultUsed}/${vaultSlots}\n\n`;
  
  if (vaultContents.length === 0) {
    narrative += '_Vault is empty._\n';
  } else {
    narrative += '**Stored Items:**\n';
    for (const item of vaultContents) {
      narrative += `  • ${RESOURCE_INFO[item.resource]?.name || item.resource} x${item.quantity}\n`;
    }
  }
  
  narrative += `\n**Commands:**\n`;
  narrative += `  • \`vault deposit item=<resource>:<qty>\` — Store items\n`;
  narrative += `  • \`vault withdraw item=<resource>:<qty>\` — Retrieve items\n`;
  narrative += `\nNext vault slot costs: ${getVaultSlotPrice(vaultSlots)}🐚`;
  
  return { success: true, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Gambling/Betting Handler ───
function handleBet(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  
  // Betting is at Trading Post (gambling den)
  if (loc.id !== 'trading_post' && loc.id !== 'ring_of_barnacles') {
    return {
      success: false,
      narrative: 'Place bets at the Trading Post gambling den or the Arena.',
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // Show available markets
  if (!target) {
    const markets = getPredictionState();
    
    let narrative = `🎰 **The Gambling Den**\n\n🐚 Your Shells: ${agent.shells}\n\n`;
    
    if (markets.length === 0) {
      narrative += '_No active prediction markets right now._\n\n';
      narrative += 'Markets open when:\n';
      narrative += '  • The Leviathan spawns\n';
      narrative += '  • A tournament begins\n';
      narrative += '  • World events occur\n';
    } else {
      narrative += '**Active Markets:**\n';
      for (const market of markets) {
        narrative += `\n📊 **${market.question}** [${market.id}]\n`;
        narrative += `  Pool: ${market.totalPool}🐚 | Bets: ${market.betsCount}\n`;
        for (let i = 0; i < market.options.length; i++) {
          narrative += `    ${i + 1}. ${market.options[i]} (${market.odds[i]}x)\n`;
        }
        if (market.resolved) {
          narrative += `  ✅ Resolved: ${market.outcome}\n`;
        }
      }
    }
    
    narrative += `\n**To bet:** \`bet <market_id> option=<number> amount=<shells>\``;
    narrative += `\nExample: \`bet boss_123 option=1 amount=50\``;
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // Place a bet
  const marketId = target;
  const optionStr = params?.option;
  const amountStr = params?.amount;
  
  if (!optionStr || !amountStr) {
    return { success: false, narrative: 'Specify option and amount. Example: `bet <market_id> option=1 amount=50`', stateChanges: [], worldEvents: [] };
  }
  
  const option = parseInt(optionStr, 10) - 1; // Convert to 0-indexed
  const amount = parseInt(amountStr, 10);
  
  if (isNaN(option) || isNaN(amount)) {
    return { success: false, narrative: 'Invalid option or amount.', stateChanges: [], worldEvents: [] };
  }
  
  if (amount < 10) {
    return { success: false, narrative: 'Minimum bet is 10 Shells.', stateChanges: [], worldEvents: [] };
  }
  
  if (agent.shells < amount) {
    return { success: false, narrative: `Not enough Shells. Need ${amount}, have ${agent.shells}.`, stateChanges: [], worldEvents: [] };
  }
  
  const result = placeBet(marketId, agentId, option, amount);
  if (!result.success) {
    return { success: false, narrative: result.message, stateChanges: [], worldEvents: [] };
  }
  
  // Deduct shells
  updateAgent(agentId, { shells: agent.shells - amount });
  
  logWorldEvent('bet_placed', `${agent.name} placed a ${amount} Shell bet.`, agent.location, [agentId]);
  
  return {
    success: true,
    narrative: `🎰 ${result.message}\n\n🐚 Shells: ${agent.shells - amount}`,
    stateChanges: [],
    worldEvents: [],
  };
}

// ─── PvP Combat Engagement System ───
interface PvPEngagement {
  id: string;
  attackerId: string;
  defenderId: string;
  attackerLastAction: number; // timestamp ms
  defenderLastAction: number;
  location: LocationId;
  startedAt: number;
}

const activePvPEngagements = new Map<string, PvPEngagement>(); // keyed by agentId (both attacker and defender point to same engagement)
const ENGAGEMENT_INACTIVITY_MS = 60000; // 60 seconds

function getEngagement(agentId: string): PvPEngagement | null {
  return activePvPEngagements.get(agentId) || null;
}

function createEngagement(attackerId: string, defenderId: string, location: LocationId): PvPEngagement {
  const engagement: PvPEngagement = {
    id: uuid(),
    attackerId,
    defenderId,
    attackerLastAction: Date.now(),
    defenderLastAction: Date.now(),
    location,
    startedAt: Date.now(),
  };
  activePvPEngagements.set(attackerId, engagement);
  activePvPEngagements.set(defenderId, engagement);
  return engagement;
}

function endEngagement(agentId: string): void {
  const engagement = activePvPEngagements.get(agentId);
  if (engagement) {
    activePvPEngagements.delete(engagement.attackerId);
    activePvPEngagements.delete(engagement.defenderId);
  }
}

function updateEngagementAction(agentId: string): void {
  const engagement = activePvPEngagements.get(agentId);
  if (engagement) {
    if (engagement.attackerId === agentId) {
      engagement.attackerLastAction = Date.now();
    } else {
      engagement.defenderLastAction = Date.now();
    }
  }
}

function checkEngagementTimeout(agentId: string): { timedOut: boolean; forfeiterId?: string } {
  const engagement = activePvPEngagements.get(agentId);
  if (!engagement) return { timedOut: false };
  
  const now = Date.now();
  const attackerInactive = now - engagement.attackerLastAction > ENGAGEMENT_INACTIVITY_MS;
  const defenderInactive = now - engagement.defenderLastAction > ENGAGEMENT_INACTIVITY_MS;
  
  if (attackerInactive) return { timedOut: true, forfeiterId: engagement.attackerId };
  if (defenderInactive) return { timedOut: true, forfeiterId: engagement.defenderId };
  return { timedOut: false };
}

// ─── Market (Auction House) Handler ───
function handleMarket(agentId: string, target?: string, params?: Record<string, string>): ActionResult {
  const agent = getAgent(agentId)!;
  
  if (agent.location !== 'trading_post') {
    return { success: false, narrative: '📍 The marketplace is at the **Trading Post**. Travel there to buy and sell.', stateChanges: [], worldEvents: [] };
  }
  
  // Get all active listings
  const listings = db.select().from(schema.marketListings).where(eq(schema.marketListings.status, 'active')).all();
  
  // market list (default) - show all listings
  if (!target || target === 'list') {
    let narrative = `🏪 **The Marketplace**\n\n`;
    narrative += `💰 Your Shells: ${agent.shells}🐚\n\n`;
    
    if (listings.length === 0) {
      narrative += `_No items for sale right now._\n\n`;
    } else {
      narrative += `**For Sale:**\n`;
      for (const listing of listings.slice(0, 20)) {
        const isYours = listing.sellerId === agentId ? ' _(yours)_' : '';
        narrative += `  [${listing.id.slice(0,8)}] **${listing.quantity}x ${RESOURCE_INFO[listing.resource as ResourceType]?.name || listing.resource}** — ${listing.priceShells}🐚 (by ${listing.sellerName})${isYours}\n`;
      }
      if (listings.length > 20) {
        narrative += `  _...and ${listings.length - 20} more_\n`;
      }
    }
    
    narrative += `\n**Commands:**\n`;
    narrative += `  • \`market sell item=<resource>:<qty> price=<shells>\` — List an item\n`;
    narrative += `  • \`market buy <listingId>\` — Purchase a listing\n`;
    narrative += `  • \`market cancel <listingId>\` — Remove your listing\n`;
    narrative += `\n_5% fee on sales goes to Merchant Ray_`;
    
    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }
  
  // market sell item=<resource>:<qty> price=<shells>
  if (target === 'sell') {
    const itemSpec = params?.item;
    const priceStr = params?.price;
    
    if (!itemSpec || !priceStr) {
      return { success: false, narrative: 'Usage: `market sell item=<resource>:<qty> price=<shells>`\nExample: `market sell item=pearl:2 price=50`', stateChanges: [], worldEvents: [] };
    }
    
    const [resource, qtyStr] = itemSpec.includes(':') ? itemSpec.split(':') : [itemSpec, '1'];
    const quantity = parseInt(qtyStr, 10);
    const price = parseInt(priceStr, 10);
    
    if (isNaN(quantity) || quantity < 1) {
      return { success: false, narrative: 'Invalid quantity.', stateChanges: [], worldEvents: [] };
    }
    if (isNaN(price) || price < 1) {
      return { success: false, narrative: 'Invalid price.', stateChanges: [], worldEvents: [] };
    }
    
    // Check player's active listings (max 5)
    const myListings = listings.filter(l => l.sellerId === agentId);
    if (myListings.length >= 5) {
      return { success: false, narrative: 'You already have 5 active listings. Cancel one first.', stateChanges: [], worldEvents: [] };
    }
    
    // Check inventory
    if (!removeFromInventory(agentId, resource as ResourceType, quantity)) {
      return { success: false, narrative: `You don't have ${quantity}x ${resource} to sell.`, stateChanges: [], worldEvents: [] };
    }
    
    // Create listing
    const listingId = uuid();
    db.insert(schema.marketListings).values({
      id: listingId,
      sellerId: agentId,
      sellerName: agent.name,
      resource,
      quantity,
      priceShells: price,
      createdTick: getTick(),
      status: 'active',
    }).run();
    
    logWorldEvent('market_listing', `${agent.name} listed ${quantity}x ${resource} for ${price}🐚`, 'trading_post', [agentId]);
    
    return {
      success: true,
      narrative: `🏪 **Listed for sale!**\n\n📦 ${quantity}x **${RESOURCE_INFO[resource as ResourceType]?.name || resource}**\n💰 Price: ${price}🐚\n\nListing ID: \`${listingId.slice(0,8)}\`\n\nOther agents can now buy this anytime.`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // market buy <listingId>
  if (target === 'buy') {
    const listingIdPrefix = params?.listing || Object.keys(params || {})[0];
    if (!listingIdPrefix) {
      return { success: false, narrative: 'Which listing? `market buy <listingId>`', stateChanges: [], worldEvents: [] };
    }
    
    // Find listing by prefix
    const listing = listings.find(l => l.id.startsWith(listingIdPrefix));
    if (!listing) {
      return { success: false, narrative: `Listing not found: ${listingIdPrefix}`, stateChanges: [], worldEvents: [] };
    }
    
    if (listing.sellerId === agentId) {
      return { success: false, narrative: `That's your own listing! Use \`market cancel ${listingIdPrefix}\` to remove it.`, stateChanges: [], worldEvents: [] };
    }
    
    if (agent.shells < listing.priceShells) {
      return { success: false, narrative: `Not enough shells. Need ${listing.priceShells}🐚, have ${agent.shells}🐚.`, stateChanges: [], worldEvents: [] };
    }
    
    // Check buyer inventory space
    const inv = getInventory(agentId);
    const invCount = inv.reduce((sum, i) => sum + i.quantity, 0);
    if (invCount + listing.quantity > agent.inventorySlots) {
      return { success: false, narrative: `Inventory full! Need ${listing.quantity} slots, have ${agent.inventorySlots - invCount}.`, stateChanges: [], worldEvents: [] };
    }
    
    // Execute purchase
    const fee = Math.ceil(listing.priceShells * 0.05); // 5% fee
    const sellerGets = listing.priceShells - fee;
    
    // Update buyer
    updateAgent(agentId, { shells: agent.shells - listing.priceShells });
    addToInventory(agentId, listing.resource as ResourceType, listing.quantity);
    
    // Update seller
    const seller = getAgent(listing.sellerId);
    if (seller) {
      updateAgent(listing.sellerId, { shells: seller.shells + sellerGets });
    }
    
    // Mark listing as sold
    db.update(schema.marketListings).set({ status: 'sold' }).where(eq(schema.marketListings.id, listing.id)).run();
    
    logWorldEvent('market_sale', `${agent.name} bought ${listing.quantity}x ${listing.resource} from ${listing.sellerName} for ${listing.priceShells}🐚`, 'trading_post', [agentId, listing.sellerId]);
    
    return {
      success: true,
      narrative: `🏪 **Purchase complete!**\n\n📦 Received: ${listing.quantity}x **${RESOURCE_INFO[listing.resource as ResourceType]?.name || listing.resource}**\n💸 Paid: ${listing.priceShells}🐚\n\n🐚 Shells: ${agent.shells - listing.priceShells}`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  // market cancel <listingId>
  if (target === 'cancel') {
    const listingIdPrefix = params?.listing || Object.keys(params || {})[0];
    if (!listingIdPrefix) {
      return { success: false, narrative: 'Which listing? `market cancel <listingId>`', stateChanges: [], worldEvents: [] };
    }
    
    const listing = listings.find(l => l.id.startsWith(listingIdPrefix) && l.sellerId === agentId);
    if (!listing) {
      return { success: false, narrative: `Listing not found or not yours: ${listingIdPrefix}`, stateChanges: [], worldEvents: [] };
    }
    
    // Return items to seller
    addToInventory(agentId, listing.resource as ResourceType, listing.quantity);
    
    // Mark as cancelled
    db.update(schema.marketListings).set({ status: 'cancelled' }).where(eq(schema.marketListings.id, listing.id)).run();
    
    return {
      success: true,
      narrative: `🏪 Listing cancelled. ${listing.quantity}x **${RESOURCE_INFO[listing.resource as ResourceType]?.name || listing.resource}** returned to inventory.`,
      stateChanges: [],
      worldEvents: [],
    };
  }
  
  return { success: false, narrative: 'Unknown market command. Try: `market list`, `market sell`, `market buy`, `market cancel`', stateChanges: [], worldEvents: [] };
}

// ─── Pursue (PvP chase mechanic) ───
function handlePursue(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];
  
  if (!target) {
    return { success: false, narrative: 'Who do you want to pursue? `pursue @AgentName`', stateChanges: [], worldEvents: [] };
  }
  
  // Check if already engaged
  if (getEngagement(agentId)) {
    return { success: false, narrative: 'You\'re already in combat! Fight or flee.', stateChanges: [], worldEvents: [] };
  }
  
  // Check if in a mob encounter
  if (activeEncounters.has(agentId)) {
    return { success: false, narrative: 'You\'re fighting a creature! Deal with it first.', stateChanges: [], worldEvents: [] };
  }
  
  const PURSUE_ENERGY = 10;
  if (agent.energy < PURSUE_ENERGY) {
    return { success: false, narrative: `Not enough energy to pursue. Need ${PURSUE_ENERGY}, have ${agent.energy}.`, stateChanges: [], worldEvents: [] };
  }
  
  // Find target agent
  const targetName = target.startsWith('@') ? target.slice(1) : target;
  const targetAgent = getAgentByName(targetName) || getAgent(targetName);
  
  if (!targetAgent) {
    return { success: false, narrative: `Agent "${targetName}" not found.`, stateChanges: [], worldEvents: [] };
  }
  
  if (targetAgent.id === agentId) {
    return { success: false, narrative: 'You cannot pursue yourself.', stateChanges: [], worldEvents: [] };
  }
  
  if (!targetAgent.isAlive) {
    return { success: false, narrative: `${targetAgent.name} is dead. Nothing to pursue.`, stateChanges: [], worldEvents: [] };
  }
  
  // Target must be in an adjacent zone or same zone
  const adjacentZones = loc.connections;
  const isAdjacent = adjacentZones.includes(targetAgent.location as LocationId);
  const isSameZone = targetAgent.location === agent.location;
  
  if (!isSameZone && !isAdjacent) {
    return { success: false, narrative: `${targetAgent.name} is too far away. They're in ${LOCATIONS[targetAgent.location as LocationId]?.name || targetAgent.location}. You can only pursue targets in adjacent zones.`, stateChanges: [], worldEvents: [] };
  }
  
  // Check if target zone is a safe zone
  const targetLoc = LOCATIONS[targetAgent.location as LocationId];
  if (targetLoc?.safeZone) {
    return { success: false, narrative: `${targetAgent.name} is in ${targetLoc.name}, a safe zone. Cannot engage in combat there.`, stateChanges: [], worldEvents: [] };
  }
  
  // If same zone, just attack
  if (isSameZone) {
    return handleAttackWithEngagement(agentId, target);
  }
  
  // Move to their zone and engage
  updateAgent(agentId, { 
    location: targetAgent.location,
    energy: agent.energy - PURSUE_ENERGY,
  });
  
  // Now attack
  const attackResult = handleAttackWithEngagement(agentId, target);
  
  let narrative = `🏃 You pursue **${targetAgent.name}** to **${targetLoc.name}**!\n\n`;
  narrative += `⚡ Energy: ${agent.energy - PURSUE_ENERGY}/${agent.maxEnergy} (-${PURSUE_ENERGY})\n\n`;
  narrative += attackResult.narrative;
  
  logWorldEvent('pursuit', `${agent.name} pursued ${targetAgent.name} to ${targetLoc.name}!`, targetAgent.location, [agentId, targetAgent.id]);
  
  return { success: attackResult.success, narrative, stateChanges: [], worldEvents: [] };
}

// ─── Modified Attack with Engagement System ───
function handleAttackWithEngagement(agentId: string, target?: string): ActionResult {
  const agent = getAgent(agentId)!;
  const loc = LOCATIONS[agent.location];

  if (loc.safeZone) {
    return {
      success: false,
      narrative: '🛡️ This is a safe zone. Combat is not allowed here.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (!target) {
    return {
      success: false,
      narrative: 'Who or what do you want to attack? Specify a target.',
      stateChanges: [],
      worldEvents: [],
    };
  }

  if (agent.energy < GAME.ENERGY_PER_ATTACK) {
    return {
      success: false,
      narrative: `Not enough energy for combat. Need ${GAME.ENERGY_PER_ATTACK}, have ${agent.energy}.`,
      stateChanges: [],
      worldEvents: [],
    };
  }

  // Check if target is a player
  const targetName = target.startsWith('@') ? target.slice(1) : target;
  const defender = getAgentByName(targetName) || getAgent(targetName);
  
  if (defender && defender.location === agent.location) {
    // This is PvP - create or continue engagement
    let engagement = getEngagement(agentId);
    
    // Check if there's an existing engagement with a DIFFERENT opponent
    if (engagement && engagement.attackerId !== defender.id && engagement.defenderId !== defender.id) {
      return { success: false, narrative: `You're already fighting someone else! Finish that fight first.`, stateChanges: [], worldEvents: [] };
    }
    
    // Check for inactivity forfeit
    if (engagement) {
      const timeout = checkEngagementTimeout(agentId);
      if (timeout.timedOut && timeout.forfeiterId) {
        const forfeiter = getAgent(timeout.forfeiterId);
        endEngagement(agentId);
        if (forfeiter) {
          // Forfeiter takes damage and flees
          const fleeDamage = Math.floor(forfeiter.maxHp * 0.2);
          updateAgent(timeout.forfeiterId, { hp: Math.max(0, forfeiter.hp - fleeDamage) });
          logWorldEvent('pvp_forfeit', `${forfeiter.name} forfeited due to inactivity!`, agent.location, [forfeiter.id]);
        }
        engagement = null; // Engagement ended
      }
    }
    
    // Create new engagement if none exists
    if (!engagement) {
      engagement = createEngagement(agentId, defender.id, agent.location as LocationId);
      logWorldEvent('pvp_engaged', `⚔️ ${agent.name} engaged ${defender.name} in combat!`, agent.location, [agentId, defender.id]);
    }
    
    // Update action timestamp
    updateEngagementAction(agentId);
    
    // Calculate damage
    const baseRoll = GAME.BASE_ATTACK_DAMAGE + Math.floor(Math.random() * 10);
    const { damage, isCrit } = calculateDamage(agentId, baseRoll);
    const damageReduction = calculateDamageReduction(defender.id);
    const finalDamage = Math.max(1, damage - damageReduction);
    const newDefHp = Math.max(0, defender.hp - finalDamage);

    updateAgent(agentId, {
      energy: agent.energy - GAME.ENERGY_PER_ATTACK,
      reputation: agent.reputation + GAME.REPUTATION_ATTACK_PENALTY,
    });
    updateAgent(defender.id, { hp: newDefHp });

    let narrative = `⚔️ **PvP COMBAT**\n\n`;
    narrative += `You strike **${defender.name}** for ${finalDamage} damage!\n`;
    narrative += `Their HP: ${newDefHp}/${defender.maxHp}\n`;
    narrative += `Your Energy: ${agent.energy - GAME.ENERGY_PER_ATTACK}/${agent.maxEnergy}\n`;
    narrative += `\n🔒 _You are engaged in combat. Neither can move until combat ends._`;

    if (newDefHp <= 0) {
      // Defeated — end engagement, handle death
      endEngagement(agentId);
      const { shellsLost, deathCount } = handleDeath(defender.id, `was defeated by ${agent.name}`);
      const loot = getInventory(defender.id);
      const dropped = loot.slice(0, 3);
      for (const item of dropped) {
        const dropAmount = Math.ceil(item.quantity / 2);
        removeFromInventory(defender.id, item.resource, dropAmount);
        addToInventory(agentId, item.resource, dropAmount);
        narrative += `  💰 Looted ${dropAmount}x ${RESOURCE_INFO[item.resource].name}\n`;
      }
      narrative += `\n💀 ${defender.name} is defeated (Deaths: ${deathCount}) and wakes at The Shallows.`;
      logWorldEvent('agent_defeated', `${agent.name} defeated ${defender.name} in combat.`, loc.id, [agentId, defender.id]);

      const xpResult = grantCombatXp(agentId, 'pvp_win');
      narrative += ` (+${xpResult.xpGained} XP)`;
      if (xpResult.leveledUp) {
        narrative += `\n\n🎉 **LEVEL UP!** You're now Level ${xpResult.newLevel}!`;
      }

      const bountyResult = checkAndClaimBountyInternal(agentId, defender.id);
      if (bountyResult) {
        narrative += bountyResult;
      }
    } else {
      narrative += `\n\n${defender.name} can: \`attack @${agent.name}\` or \`flee\``;
    }

    return { success: true, narrative, stateChanges: [], worldEvents: [] };
  }

  // Not a player - check for NPCs (existing logic will handle)
  return { success: false, narrative: `Target "${target}" not found at your location.`, stateChanges: [], worldEvents: [] };
}

// ─── Modified Flee for PvP ───
function handlePvPFlee(agentId: string): ActionResult {
  const agent = getAgent(agentId)!;
  const engagement = getEngagement(agentId);
  
  if (!engagement) {
    return { success: false, narrative: 'You\'re not in PvP combat.', stateChanges: [], worldEvents: [] };
  }
  
  const opponentId = engagement.attackerId === agentId ? engagement.defenderId : engagement.attackerId;
  const opponent = getAgent(opponentId);
  
  // Flee chance: base 50%, +5% per level above opponent, -5% per level below
  const levelDiff = agent.level - (opponent?.level || 1);
  const fleeChance = Math.min(0.9, Math.max(0.2, 0.5 + (levelDiff * 0.05)));
  const roll = Math.random();
  const success = roll < fleeChance;
  
  updateEngagementAction(agentId);
  
  if (success) {
    // Escape to random adjacent zone
    const loc = LOCATIONS[agent.location];
    const safeAdjacent = loc.connections.filter(z => !LOCATIONS[z].safeZone || z === 'shallows');
    const escapeZone = safeAdjacent[Math.floor(Math.random() * safeAdjacent.length)] || 'shallows';
    
    endEngagement(agentId);
    updateAgent(agentId, { location: escapeZone });
    
    logWorldEvent('pvp_flee', `${agent.name} escaped from ${opponent?.name || 'combat'}!`, agent.location, [agentId, opponentId]);
    
    return {
      success: true,
      narrative: `🏃 **ESCAPED!**\n\nYou successfully flee to **${LOCATIONS[escapeZone].name}**!\n\n_Combat ended._`,
      stateChanges: [],
      worldEvents: [],
    };
  } else {
    // Failed flee - opponent gets free attack
    if (opponent) {
      const baseRoll = GAME.BASE_ATTACK_DAMAGE + Math.floor(Math.random() * 10);
      const { damage } = calculateDamage(opponentId, baseRoll);
      const damageReduction = calculateDamageReduction(agentId);
      const finalDamage = Math.max(1, damage - damageReduction);
      const newHp = Math.max(0, agent.hp - finalDamage);
      
      updateAgent(agentId, { hp: newHp });
      
      let narrative = `🏃 **FLEE FAILED!** (${Math.floor(fleeChance * 100)}% chance)\n\n`;
      narrative += `${opponent.name} strikes you as you turn! ${finalDamage} damage!\n`;
      narrative += `❤️ HP: ${newHp}/${agent.maxHp}`;
      
      if (newHp <= 0) {
        endEngagement(agentId);
        const { shellsLost, deathCount } = handleDeath(agentId, `was killed trying to flee from ${opponent.name}`);
        narrative += `\n\n💀 You died while fleeing! (Deaths: ${deathCount}, Lost ${shellsLost}🐚)`;
        
        // Opponent gets XP
        const xpResult = grantCombatXp(opponentId, 'pvp_win');
        logWorldEvent('agent_defeated', `${opponent.name} defeated ${agent.name} while they tried to flee.`, agent.location, [opponentId, agentId]);
      }
      
      return { success: false, narrative, stateChanges: [], worldEvents: [] };
    }
    
    return {
      success: false,
      narrative: `🏃 **FLEE FAILED!** You stumble and can't escape!`,
      stateChanges: [],
      worldEvents: [],
    };
  }
}

// Export prediction state for dashboard
export { getPredictionState, getEngagement, activePvPEngagements };

// ─── Persistence Layer ───
// Save/load critical game state to/from database

export function persistParties() {
  // Clear old data
  db.delete(schema.parties).run();
  
  // Save current parties
  for (const [id, party] of activeParties) {
    db.insert(schema.parties).values({
      id,
      leaderId: party.leaderId,
      leaderName: party.leaderName,
      members: JSON.stringify(party.members),
      status: party.status,
      invites: JSON.stringify(Object.fromEntries(party.invites)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();
  }
}

export function loadParties() {
  const rows = db.select().from(schema.parties).all();
  activeParties.clear();
  agentPartyMap.clear();
  
  for (const row of rows) {
    const members = JSON.parse(row.members || '[]');
    const invites = new Map(Object.entries(JSON.parse(row.invites || '{}')));
    
    activeParties.set(row.id, {
      id: row.id,
      leaderId: row.leaderId,
      leaderName: row.leaderName,
      members,
      status: row.status as 'forming' | 'in_dungeon' | 'disbanded',
      invites,
    });
    
    // Rebuild agent-party map
    for (const memberId of members) {
      agentPartyMap.set(memberId, row.id);
    }
  }
  console.log(`📦 Loaded ${rows.length} parties from DB`);
}

export function persistDungeons() {
  // Clear old data
  db.delete(schema.dungeons).run();
  
  // Save current dungeons
  for (const [id, dungeon] of activeDungeons) {
    db.insert(schema.dungeons).values({
      id,
      partyId: dungeon.partyId,
      zoneId: dungeon.zoneId,
      wave: dungeon.wave,
      maxWaves: dungeon.maxWaves,
      mobsRemaining: dungeon.mobsRemaining,
      bossHp: dungeon.bossHp,
      bossMaxHp: dungeon.bossMaxHp,
      status: dungeon.status,
      damage: JSON.stringify(Object.fromEntries(dungeon.damage)),
      chat: JSON.stringify(dungeon.chat),
      startedTick: dungeon.startedTick,
      updatedAt: Date.now(),
    }).run();
  }
}

export function loadDungeons() {
  const rows = db.select().from(schema.dungeons).all();
  activeDungeons.clear();
  
  for (const row of rows) {
    if (row.status !== 'active') continue; // Only load active dungeons
    
    activeDungeons.set(row.id, {
      id: row.id,
      partyId: row.partyId,
      zoneId: row.zoneId as LocationId,
      wave: row.wave,
      maxWaves: row.maxWaves,
      mobsRemaining: row.mobsRemaining,
      bossHp: row.bossHp,
      bossMaxHp: row.bossMaxHp,
      status: row.status as 'active' | 'cleared' | 'failed' | 'abandoned',
      damage: new Map(Object.entries(JSON.parse(row.damage || '{}'))),
      chat: JSON.parse(row.chat || '[]'),
      startedTick: row.startedTick,
    });
  }
  console.log(`📦 Loaded ${activeDungeons.size} active dungeons from DB`);
}

export function persistPvPEngagements() {
  // Clear old data
  db.delete(schema.pvpEngagements).run();
  
  // Save current engagements
  const saved = new Set<string>(); // Track saved engagement IDs
  for (const [, engagement] of activePvPEngagements) {
    if (saved.has(engagement.attackerId + engagement.defenderId)) continue;
    saved.add(engagement.attackerId + engagement.defenderId);
    
    db.insert(schema.pvpEngagements).values({
      id: `${engagement.attackerId}-${engagement.defenderId}`,
      attackerId: engagement.attackerId,
      defenderId: engagement.defenderId,
      attackerName: engagement.attackerName,
      defenderName: engagement.defenderName,
      location: engagement.location,
      startedTick: engagement.startedTick,
      lastActionTick: engagement.lastActionTick,
      status: 'active',
    }).run();
  }
}

export function loadPvPEngagements() {
  const rows = db.select().from(schema.pvpEngagements).all();
  activePvPEngagements.clear();
  
  for (const row of rows) {
    if (row.status !== 'active') continue;
    
    const engagement = {
      attackerId: row.attackerId,
      defenderId: row.defenderId,
      attackerName: row.attackerName,
      defenderName: row.defenderName,
      location: row.location,
      startedTick: row.startedTick,
      lastActionTick: row.lastActionTick,
    };
    
    activePvPEngagements.set(row.attackerId, engagement);
    activePvPEngagements.set(row.defenderId, engagement);
  }
  console.log(`📦 Loaded ${rows.length} PvP engagements from DB`);
}

export function persistBossState() {
  // Persist Leviathan
  db.delete(schema.bossState).where(eq(schema.bossState.id, 'leviathan')).run();
  db.insert(schema.bossState).values({
    id: 'leviathan',
    hp: LEVIATHAN.currentHp,
    maxHp: LEVIATHAN.maxHp,
    isActive: LEVIATHAN.isAlive,
    spawnTick: null,
    lastKilledTick: LEVIATHAN.lastDeathTick || null,
    nextSpawnTick: LEVIATHAN.nextSpawnTick || null,
    participants: JSON.stringify(Object.fromEntries(LEVIATHAN.participants)),
    participantWallets: JSON.stringify(Object.fromEntries(LEVIATHAN.participantWallets)),
    gateOpen: LEVIATHAN.hpScaled, // Reuse gateOpen field for hpScaled
    contributions: '{}',
    phase: 1,
    updatedAt: Date.now(),
  }).run();
  
  // Persist The Null (Abyss state)
  db.delete(schema.bossState).where(eq(schema.bossState.id, 'null')).run();
  db.insert(schema.bossState).values({
    id: 'null',
    hp: ABYSS_STATE.nullHp,
    maxHp: ABYSS_STATE.nullMaxHp,
    isActive: ABYSS_STATE.isOpen,
    spawnTick: ABYSS_STATE.openedAtTick || null,
    lastKilledTick: null,
    nextSpawnTick: null,
    participants: JSON.stringify(Object.fromEntries(ABYSS_STATE.participants)),
    participantWallets: '{}',
    gateOpen: ABYSS_STATE.isOpen,
    contributions: JSON.stringify(Object.fromEntries(ABYSS_STATE.contributions)),
    phase: ABYSS_STATE.nullPhase,
    updatedAt: Date.now(),
  }).run();
}

export function loadBossState() {
  const rows = db.select().from(schema.bossState).all();
  
  for (const row of rows) {
    if (row.id === 'leviathan') {
      LEVIATHAN.currentHp = row.hp;
      LEVIATHAN.maxHp = row.maxHp;
      LEVIATHAN.isAlive = row.isActive;
      LEVIATHAN.lastDeathTick = row.lastKilledTick || 0;
      LEVIATHAN.nextSpawnTick = row.nextSpawnTick || 0;
      LEVIATHAN.hpScaled = row.gateOpen || false; // Reuse gateOpen field for hpScaled
      LEVIATHAN.participants = new Map(Object.entries(JSON.parse(row.participants || '{}')).map(([k, v]) => [k, Number(v)]));
      LEVIATHAN.participantWallets = new Map(Object.entries(JSON.parse(row.participantWallets || '{}')));
      console.log(`📦 Loaded Leviathan state: HP=${row.hp}/${row.maxHp}, alive=${row.isActive}, hpScaled=${LEVIATHAN.hpScaled}`);
    } else if (row.id === 'null') {
      ABYSS_STATE.nullHp = row.hp;
      ABYSS_STATE.nullMaxHp = row.maxHp;
      ABYSS_STATE.isOpen = row.isActive;
      ABYSS_STATE.openedAtTick = row.spawnTick || 0;
      ABYSS_STATE.nullPhase = row.phase;
      ABYSS_STATE.participants = new Map(Object.entries(JSON.parse(row.participants || '{}')).map(([k, v]) => [k, Number(v)]));
      ABYSS_STATE.contributions = new Map(Object.entries(JSON.parse(row.contributions || '{}')));
      console.log(`📦 Loaded Null state: HP=${row.hp}, isOpen=${row.isActive}, phase=${row.phase}`);
    }
  }
}

export function persistArenaDuels() {
  // Clear and save
  db.delete(schema.arenaDuels).run();
  
  // Save active duels
  for (const [id, duel] of activeDuels) {
    db.insert(schema.arenaDuels).values({
      id,
      challengerId: duel.challengerId,
      challengedId: duel.challengedId,
      challengerName: duel.challengerName,
      challengedName: duel.challengedName,
      wager: duel.wager,
      status: duel.status,
      challengerHp: duel.challengerHp,
      challengedHp: duel.challengedHp,
      winnerId: duel.winnerId || null,
      bets: JSON.stringify(Object.fromEntries(duel.bets)),
      createdTick: duel.createdTick,
      updatedAt: Date.now(),
    }).run();
  }
  
  // Save pending challenges
  for (const [challengedId, duel] of pendingChallenges) {
    if (!activeDuels.has(duel.id)) {
      db.insert(schema.arenaDuels).values({
        id: duel.id,
        challengerId: duel.challengerId,
        challengedId: duel.challengedId,
        challengerName: duel.challengerName,
        challengedName: duel.challengedName,
        wager: duel.wager,
        status: 'pending',
        challengerHp: duel.challengerHp,
        challengedHp: duel.challengedHp,
        winnerId: null,
        bets: JSON.stringify(Object.fromEntries(duel.bets)),
        createdTick: duel.createdTick,
        updatedAt: Date.now(),
      }).run();
    }
  }
}

export function loadArenaDuels() {
  const rows = db.select().from(schema.arenaDuels).all();
  activeDuels.clear();
  pendingChallenges.clear();
  
  for (const row of rows) {
    const duel = {
      id: row.id,
      challengerId: row.challengerId,
      challengedId: row.challengedId,
      challengerName: row.challengerName,
      challengedName: row.challengedName,
      wager: row.wager,
      status: row.status as 'pending' | 'active' | 'completed',
      challengerHp: row.challengerHp || 0,
      challengedHp: row.challengedHp || 0,
      winnerId: row.winnerId || undefined,
      bets: new Map(Object.entries(JSON.parse(row.bets || '{}'))),
      createdTick: row.createdTick,
    };
    
    if (row.status === 'active') {
      activeDuels.set(row.id, duel);
    } else if (row.status === 'pending') {
      pendingChallenges.set(row.challengedId, duel);
    }
  }
  console.log(`📦 Loaded ${activeDuels.size} active duels, ${pendingChallenges.size} pending challenges`);
}

export function persistAgentQuests() {
  db.delete(schema.agentQuests).run();
  
  for (const [agentId, questIds] of agentQuests) {
    db.insert(schema.agentQuests).values({
      agentId,
      questIds: JSON.stringify(questIds),
      updatedAt: Date.now(),
    }).run();
  }
}

export function loadAgentQuests() {
  const rows = db.select().from(schema.agentQuests).all();
  agentQuests.clear();
  
  for (const row of rows) {
    agentQuests.set(row.agentId, JSON.parse(row.questIds || '[]'));
  }
  console.log(`📦 Loaded quests for ${rows.length} agents`);
}

export function persistCooldowns() {
  db.delete(schema.cooldowns).run();
  
  // Rest cooldowns
  for (const [agentId, time] of lastRestTime) {
    db.insert(schema.cooldowns).values({
      id: `${agentId}_rest`,
      agentId,
      cooldownType: 'rest',
      value: time,
      expiresAt: null,
    }).run();
  }
  
  // Broadcast cooldowns
  for (const [agentId, time] of lastBroadcastTime) {
    db.insert(schema.cooldowns).values({
      id: `${agentId}_broadcast`,
      agentId,
      cooldownType: 'broadcast',
      value: time,
      expiresAt: null,
    }).run();
  }
  
  // Dungeon daily runs
  for (const [agentId, data] of dungeonDailyRuns) {
    db.insert(schema.cooldowns).values({
      id: `${agentId}_dungeon_daily`,
      agentId,
      cooldownType: 'dungeon_daily',
      value: data.count,
      expiresAt: data.resetAt,
    }).run();
  }
}

export function loadCooldowns() {
  const rows = db.select().from(schema.cooldowns).all();
  lastRestTime.clear();
  lastBroadcastTime.clear();
  dungeonDailyRuns.clear();
  
  for (const row of rows) {
    if (row.cooldownType === 'rest') {
      lastRestTime.set(row.agentId, row.value);
    } else if (row.cooldownType === 'broadcast') {
      lastBroadcastTime.set(row.agentId, row.value);
    } else if (row.cooldownType === 'dungeon_daily') {
      dungeonDailyRuns.set(row.agentId, { count: row.value, resetAt: row.expiresAt || 0 });
    }
  }
  console.log(`📦 Loaded ${rows.length} cooldowns`);
}

// Load all persisted state on startup
export function loadPersistedState() {
  console.log('📦 Loading persisted game state...');
  loadParties();
  loadDungeons();
  loadPvPEngagements();
  loadBossState();
  loadArenaDuels();
  loadAgentQuests();
  loadCooldowns();
  console.log('📦 Persisted state loaded!');
}

// Save all state (call periodically or on changes)
export function persistAllState() {
  persistParties();
  persistDungeons();
  persistPvPEngagements();
  persistBossState();
  persistArenaDuels();
  persistAgentQuests();
  persistCooldowns();
}
