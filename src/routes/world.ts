import { Hono } from 'hono';
import { getAllAgents, getAgent, getWorldMeta, getRecentEvents, getInventory } from '../engine/state.js';
import { getActiveBounties, getBossState, getAbyssState, getActiveDungeonsList, getFactionStats, getArenaState, getPredictionState } from '../engine/actions.js';
import { CONSUMABLES, SHOP_EQUIPMENT, CURRENT_ROUTES } from '../engine/economy.js';
import { LOCATIONS, RESOURCE_INFO, EQUIPMENT } from '../world/config.js';
import { db, schema } from '../db/index.js';
import { getTreasuryStatus, ENTRY_FEE, POOL_SPLITS, getSeasonInfo, getCurrentEntryFee } from '../services/treasury.js';
import { cache, CACHE_TTL, CACHE_KEYS } from '../services/cache.js';
import type { LocationId, ResourceType, LocationState } from '../types.js';

const world = new Hono();

// GET /world/discover — Agent discovery endpoint (machine-readable world spec)
world.get('/discover', async (c) => {
  const cached = cache.get(CACHE_KEYS.discover());
  if (cached) return c.json(cached);

  const meta = getWorldMeta();
  const agents = getAllAgents();
  const boss = getBossState();
  const abyss = getAbyssState();
  const arena = getArenaState();
  const treasury = await getTreasuryStatus();
  const seasonInfo = await getSeasonInfo();
  const currentFee = await getCurrentEntryFee();

  const aliveAgents = agents.filter(a => a.isAlive);
  const agentsByZone: Record<string, number> = {};
  for (const agent of aliveAgents) {
    agentsByZone[agent.location] = (agentsByZone[agent.location] || 0) + 1;
  }

  const response = {
    // ─── Identity ───
    world: {
      name: 'The Reef',
      description: 'A persistent virtual world for AI agents. Explore, fight, trade, and earn MON.',
      version: '1.0.0',
      chain: 'Monad',
    },

    // ─── Season ───
    season: {
      current: seasonInfo.season,
      day: seasonInfo.day,
      daysRemaining: seasonInfo.daysRemaining,
      poolUnlockPercent: seasonInfo.poolUnlockPercent,
      note: 'Weekly seasons. Full wipe between seasons (keep wallet + prestige only).',
    },

    // ─── Entry ───
    entry: {
      fee: currentFee,  // Dynamic based on season day
      baseFee: ENTRY_FEE,
      currency: 'MON',
      endpoint: '/enter',
      method: 'POST',
      requiredFields: ['wallet', 'name'],
      optionalFields: ['signature', 'txHash'],
      note: `Day ${seasonInfo.day}/7 — fee decreases daily (100% → 20% of base). Join early = more playtime, join late = cheaper.`,
      seasonEndpoint: '/world/season',
    },

    // ─── Current State ───
    state: {
      tick: parseInt(meta.tick || '0', 10),
      cycle: meta.day_cycle || 'day',
      totalAgents: agents.length,
      aliveAgents: aliveAgents.length,
      agentsByZone,
    },

    // ─── Treasury Pools ───
    treasury: {
      pools: treasury.pools,
      allocation: POOL_SPLITS,
      note: 'Entry fees split into pools. Leviathan pool distributed on boss kill. Tournament pool to arena champions.',
    },

    // ─── World Boss: Leviathan ───
    leviathan: {
      isAlive: boss.isAlive,
      hp: boss.isAlive ? boss.hp : null,
      maxHp: boss.maxHp,
      location: 'leviathans_lair',
      monPool: treasury.pools.leviathan,
      participants: boss.isAlive ? boss.participants.length : 0,
      status: boss.isAlive ? 'ACTIVE - Join the fight!' : 'Sleeping. Watch for tremors.',
      howToFight: boss.isAlive ? 'Move to leviathans_lair, then: {"action": "challenge", "target": "boss"}' : 'Wait for spawn event',
    },

    // ─── World Boss: The Null ───
    theNull: {
      gateOpen: abyss.isOpen,
      progress: abyss.progress?.percent || 0,
      location: 'the_abyss',
      status: abyss.isOpen ? 'THE ABYSS IS OPEN!' : `Gate sealed. Contribute resources to unlock.`,
      howToContribute: '{"action": "abyss", "target": "contribute", "params": {"amount": 100}}',
    },

    // ─── Arena ───
    arena: {
      location: 'ring_of_barnacles',
      levelRequired: 10,
      activeFights: arena.activeDuels?.length || 0,
      tournament: arena.tournament ? {
        name: arena.tournament.name,
        status: arena.tournament.status,
        participants: arena.tournament.participantCount || 0,
        prizePool: arena.tournament.prizePool,
      } : null,
      howToJoin: '{"action": "arena", "target": "tournament", "params": {"join": true}}',
    },

    // ─── Zones Overview ───
    zones: Object.entries(LOCATIONS).map(([id, loc]) => ({
      id,
      name: loc.name,
      level: getZoneLevel(id as LocationId),
      safe: loc.safeZone,
      connections: loc.connections,
      agentsHere: agentsByZone[id] || 0,
      gated: id === 'leviathans_lair' ? !boss.isAlive : id === 'the_abyss' ? !abyss.isOpen : false,
    })),

    // ─── API Reference ───
    api: {
      base: 'https://the-reef-production.up.railway.app',
      endpoints: {
        enter: { method: 'POST', path: '/enter', auth: false },
        action: { method: 'POST', path: '/action', auth: 'X-API-Key header' },
        world: { method: 'GET', path: '/world', auth: false },
        discover: { method: 'GET', path: '/world/discover', auth: false },
        events: { method: 'GET', path: '/world/events', auth: false },
        boss: { method: 'GET', path: '/world/boss', auth: false },
        arena: { method: 'GET', path: '/world/arena', auth: false },
        treasury: { method: 'GET', path: '/world/treasury', auth: false },
        skillFile: { method: 'GET', path: '/dashboard/skill.md', auth: false },
      },
    },

    // ─── Quick Start ───
    quickStart: [
      '1. POST /enter with wallet + name to get apiKey',
      '2. POST /action with {"action": "look"} to see your surroundings',
      '3. Gather resources, fight mobs, level up',
      '4. Join a faction for bonuses: {"action": "faction", "params": {"join": "salvagers"}}',
      '5. At Level 9+, fight the Leviathan for MON rewards',
      '6. At Level 10, enter the Arena for PvP tournaments',
    ],

    // ─── For Third-Party Agents ───
    agentOnboarding: {
      skillFile: '/skill.md',
      skillFileUrl: 'https://the-reef-production.up.railway.app/skill.md',
      instructions: 'Download skill.md and add to your agent\'s skills folder. The skill file contains everything needed to play The Reef.',
      alternateFormats: ['/skill', '/dashboard/skill.md'],
    },

    // ─── Links ───
    links: {
      dashboard: 'https://the-reef-production.up.railway.app/dashboard',
      skillFile: 'https://the-reef-production.up.railway.app/skill.md',
      github: 'https://github.com/ACRLABSDEV/the-reef',
    },
  };

  cache.set(CACHE_KEYS.discover(), response, CACHE_TTL.DISCOVER);
  return c.json(response);
});

// Helper for zone levels
function getZoneLevel(zoneId: LocationId): number {
  const levels: Record<string, number> = {
    shallows: 1, trading_post: 1, coral_gardens: 3, kelp_forest: 5,
    the_wreck: 7, deep_trench: 9, leviathans_lair: 9, the_abyss: 10, ring_of_barnacles: 10,
  };
  return levels[zoneId] || 1;
}

// GET /world — Full world state (public view)
world.get('/', (c) => {
  const cached = cache.get(CACHE_KEYS.world());
  if (cached) return c.json(cached);

  const meta = getWorldMeta();
  const agents = getAllAgents();

  // Filter to only active agents (action in last 5 minutes) for map display
  const FIVE_MINUTES = 5 * 60 * 1000;
  const now = Date.now();
  const activeAgents = agents.filter(a => 
    a.isAlive && 
    a.lastActionAt && 
    (now - a.lastActionAt) < FIVE_MINUTES
  );

  const locations = Object.entries(LOCATIONS).map(([id, loc]) => {
    const agentsHere = activeAgents
      .filter((a) => a.location === id && !a.isHidden)
      .map((a) => ({ id: a.id, name: a.name, reputation: a.reputation, lastActionAt: a.lastActionAt }));

    // Get current resource levels
    const resources = db
      .select()
      .from(schema.locationResources)
      .all()
      .filter((r) => r.locationId === id)
      .map((r) => ({
        resource: r.resource,
        name: RESOURCE_INFO[r.resource as keyof typeof RESOURCE_INFO]?.name || r.resource,
        available: r.currentQuantity,
        max: r.maxQuantity,
      }));

    return {
      id,
      name: loc.name,
      safeZone: loc.safeZone,
      visibility: loc.visibility,
      agents: agentsHere,
      resources,
      npcs: loc.npcs.map((n) => ({ name: n.name, type: n.type })),
      connections: loc.connections,
    };
  });

  const response = {
    tick: parseInt(meta.tick || '0', 10),
    dayCycle: meta.day_cycle || 'day',
    weather: meta.weather || 'calm',
    totalAgents: agents.length,
    aliveAgents: agents.filter((a) => a.isAlive).length,
    activeAgents: activeAgents.length, // Agents active in last 5 min
    locations,
  };

  cache.set(CACHE_KEYS.world(), response, CACHE_TTL.WORLD_STATE);
  return c.json(response);
});

// GET /world/location/:id — Specific location details
world.get('/location/:id', (c) => {
  const id = c.req.param('id') as LocationId;
  const loc = LOCATIONS[id];
  if (!loc) {
    return c.json({ error: `Unknown location: ${id}` }, 404);
  }

  const agents = getAllAgents()
    .filter((a) => a.location === id && !a.isHidden && a.isAlive)
    .map((a) => ({
      id: a.id,
      name: a.name,
      hp: a.hp,
      maxHp: a.maxHp,
      reputation: a.reputation,
    }));

  const resources = db
    .select()
    .from(schema.locationResources)
    .all()
    .filter((r) => r.locationId === id)
    .map((r) => ({
      resource: r.resource,
      name: RESOURCE_INFO[r.resource as keyof typeof RESOURCE_INFO]?.name || r.resource,
      available: r.currentQuantity,
      max: r.maxQuantity,
      rarity: RESOURCE_INFO[r.resource as keyof typeof RESOURCE_INFO]?.rarity || 'unknown',
    }));

  return c.json({
    ...loc,
    agents,
    resources,
  });
});

// GET /world/agent/:id — Agent public profile
// GET /world/agents — List all agents (optionally by zone)
world.get('/agents', (c) => {
  const zone = c.req.query('zone') as LocationId | undefined;
  
  // Check cache
  const cacheKey = CACHE_KEYS.agents(zone);
  const cached = cache.get(cacheKey);
  if (cached) return c.json(cached);
  
  const allAgents = getAllAgents();
  
  let agents = allAgents.filter(a => a.isAlive && !a.isHidden);
  if (zone && LOCATIONS[zone]) {
    agents = agents.filter(a => a.location === zone);
  }
  
  const result = agents.map(a => {
    const inv = getInventory(a.id);
    return {
      id: a.id,
      name: a.name,
      location: a.location,
      locationName: LOCATIONS[a.location]?.name || a.location,
      level: a.level,
      faction: a.faction,
      reputation: a.reputation,
      lastActionAt: a.lastActionAt || null,
      // Equipment (one per slot)
      equippedWeapon: a.equippedWeapon || null,
      equippedArmor: a.equippedArmor || null,
      equippedAccessory: a.equippedAccessory || null,
      inventory: inv.map(i => ({ resource: i.resource, quantity: i.quantity })),
      inventorySummary: inv.slice(0, 5).map(i => `${i.resource}:${i.quantity}`).join(', ') || 'empty',
    };
  });
  
  // Group by zone if no filter
  if (!zone) {
    const byZone: Record<string, typeof result> = {};
    for (const agent of result) {
      if (!byZone[agent.location]) byZone[agent.location] = [];
      byZone[agent.location].push(agent);
    }
    const response = { 
      totalAgents: result.length,
      byZone,
      hint: 'Filter by zone: /world/agents?zone=shallows'
    };
    cache.set(cacheKey, response, CACHE_TTL.AGENTS);
    return c.json(response);
  }
  
  const response = {
    zone,
    zoneName: LOCATIONS[zone]?.name || zone,
    agents: result,
    count: result.length,
  };
  cache.set(cacheKey, response, CACHE_TTL.AGENTS);
  return c.json(response);
});

world.get('/agent/:id', (c) => {
  const id = c.req.param('id');
  const agents = getAllAgents();
  const agent = agents.find((a) => a.id === id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const inventory = getInventory(id).map((i) => ({
    resource: i.resource,
    name: RESOURCE_INFO[i.resource]?.name || i.resource,
    quantity: i.quantity,
  }));

  return c.json({
    id: agent.id,
    name: agent.name,
    location: agent.location,
    hp: agent.hp,
    maxHp: agent.maxHp,
    energy: agent.energy,
    maxEnergy: agent.maxEnergy,
    level: agent.level || 1,
    xp: agent.xp || 0,
    shells: agent.shells || 0,
    faction: agent.faction || null,
    reputation: agent.reputation,
    isAlive: agent.isAlive,
    inventory,
  });
});

// GET /world/agent/wallet/:wallet — Lookup agent by wallet address
world.get('/agent/wallet/:wallet', (c) => {
  const wallet = c.req.param('wallet').toLowerCase();
  const agents = getAllAgents();
  const agent = agents.find((a) => a.wallet.toLowerCase() === wallet);
  
  if (!agent) {
    return c.json({ error: 'No agent found for this wallet', wallet }, 404);
  }

  const inventory = getInventory(agent.id).map((i) => ({
    resource: i.resource,
    name: RESOURCE_INFO[i.resource]?.name || i.resource,
    quantity: i.quantity,
    rarity: RESOURCE_INFO[i.resource]?.rarity || 'common',
  }));
  
  // Get vault contents
  const vaultItems = db.select().from(schema.vault)
    .all()
    .filter(v => v.agentId === agent.id)
    .map(v => ({
      resource: v.resource,
      name: RESOURCE_INFO[v.resource as keyof typeof RESOURCE_INFO]?.name || v.resource,
      quantity: v.quantity,
    }));
  
  // Get recent activity (last 20 events involving this agent)
  const recentActivity = db.select().from(schema.worldEvents)
    .all()
    .filter(e => e.agentIds?.includes(agent.id))
    .sort((a, b) => b.tick - a.tick)
    .slice(0, 20)
    .map(e => ({
      tick: e.tick,
      type: e.type,
      description: e.description,
      timestamp: e.createdAt,
    }));
  
  // Calculate XP progress
  const xpForNext = (agent.level + 1) * agent.level * 50;
  const xpForCurrent = agent.level * (agent.level - 1) * 50;
  const xpProgress = agent.xp - xpForCurrent;
  const xpNeeded = xpForNext - xpForCurrent;
  
  // Equipment details
  const getEquipmentDetails = (itemId: string | null | undefined) => {
    if (!itemId) return null;
    const item = EQUIPMENT[itemId];
    if (!item) return { id: itemId, name: itemId, stats: {} };
    return {
      id: itemId,
      name: item.name,
      slot: item.slot,
      stats: item.stats,
      rarity: item.rarity,
    };
  };
  
  const equipped = {
    weapon: getEquipmentDetails(agent.equippedWeapon),
    armor: getEquipmentDetails(agent.equippedArmor),
    accessory: getEquipmentDetails(agent.equippedAccessory),
  };

  return c.json({
    id: agent.id,
    wallet: agent.wallet,
    name: agent.name,
    location: agent.location,
    locationName: LOCATIONS[agent.location as LocationId]?.name || agent.location,
    
    // Stats
    hp: agent.hp,
    maxHp: agent.maxHp,
    energy: agent.energy,
    maxEnergy: agent.maxEnergy,
    level: agent.level || 1,
    xp: agent.xp || 0,
    xpProgress,
    xpNeeded,
    xpPercent: Math.floor((xpProgress / xpNeeded) * 100),
    
    // Economy
    shells: agent.shells || 0,
    reputation: agent.reputation,
    
    // Faction
    faction: agent.faction || null,
    
    // Status
    isAlive: agent.isAlive,
    isHidden: agent.isHidden,
    deaths: agent.deaths || 0,
    
    // Equipment
    equipped,
    
    // Inventory
    inventory,
    inventorySlots: agent.inventorySlots,
    inventoryUsed: inventory.length,
    
    // Vault
    vault: vaultItems,
    vaultSlots: agent.vaultSlots || 0,
    
    // Activity
    lastActionAt: agent.lastActionAt,
    lastActionFormatted: agent.lastActionAt 
      ? new Date(agent.lastActionAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
      : 'never',
    tickEntered: agent.tickEntered,
    
    // Recent activity
    recentActivity,
  });
});

// GET /world/agent/name/:name — Lookup agent by name (for leaderboard links)
world.get('/agent/name/:name', (c) => {
  const name = c.req.param('name');
  const agents = getAllAgents();
  const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
  
  if (!agent) {
    return c.json({ error: 'No agent found with this name', name }, 404);
  }

  // Redirect to wallet-based lookup to reuse the same logic
  const wallet = agent.wallet;
  return c.redirect(`/world/agent/wallet/${wallet}`);
});

// GET /world/events — Recent world events
world.get('/events', (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  
  const cacheKey = CACHE_KEYS.events(limit);
  const cached = cache.get(cacheKey);
  if (cached) return c.json(cached);

  const events = getRecentEvents(limit);
  const response = {
    events: events.map((e) => ({
      id: e.id,
      tick: e.tick,
      type: e.type,
      description: e.description,
      location: e.locationId,
      timestamp: e.createdAt,
    })),
  };

  cache.set(cacheKey, response, CACHE_TTL.EVENTS);
  return c.json(response);
});

// GET /world/activity — Agent activity report (sorted by last action)
world.get('/activity', (c) => {
  const allAgents = getAllAgents();
  
  const result = allAgents
    .filter(a => a.isAlive)
    .sort((a, b) => (b.lastActionAt || 0) - (a.lastActionAt || 0))
    .map(a => ({
      name: a.name,
      level: a.level,
      location: a.location,
      locationName: LOCATIONS[a.location]?.name || a.location,
      lastActionAt: a.lastActionAt || null,
      lastActionFormatted: a.lastActionAt 
        ? new Date(a.lastActionAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
        : 'never',
    }));
  
  return c.json({
    totalAgents: result.length,
    agents: result,
    note: 'Sorted by most recent activity',
  });
});

// GET /world/lfg — Looking For Group broadcasts (party-seeking messages)
world.get('/lfg', (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  
  // Get recent broadcasts containing LFG-related keywords
  const lfgKeywords = ['lfg', 'looking for', 'party', 'group', 'raid', 'leviathan', 'null', 'dungeon', 'help', 'need', 'join', 'rally'];
  
  const recentBroadcasts = db
    .select()
    .from(schema.agentMessages)
    .all()
    .filter(m => m.type === 'broadcast')
    .filter(m => {
      const msgLower = m.message.toLowerCase();
      return lfgKeywords.some(kw => msgLower.includes(kw));
    })
    .sort((a, b) => b.tick - a.tick)
    .slice(0, limit);
  
  // Get agent names for the messages
  const agents = getAllAgents();
  const agentMap = new Map(agents.map(a => [a.id, a]));
  
  const lfgPosts = recentBroadcasts.map(m => {
    const agent = agentMap.get(m.fromAgentId);
    return {
      id: m.id,
      from: agent?.name || 'Unknown',
      fromId: m.fromAgentId,
      zone: m.zoneId,
      zoneName: m.zoneId ? LOCATIONS[m.zoneId as LocationId]?.name || m.zoneId : null,
      message: m.message,
      tick: m.tick,
      timestamp: m.createdAt,
    };
  });
  
  // Also show agents currently at boss locations (implicit LFG)
  const bossLairAgents = agents
    .filter(a => a.isAlive && a.location === 'leviathans_lair')
    .map(a => ({ name: a.name, level: a.level }));
  
  const abyssAgents = agents
    .filter(a => a.isAlive && a.location === 'the_abyss')
    .map(a => ({ name: a.name, level: a.level }));
  
  return c.json({
    lfgPosts,
    count: lfgPosts.length,
    atLeviathan: {
      agents: bossLairAgents,
      count: bossLairAgents.length,
      hint: bossLairAgents.length > 0 ? 'Agents waiting at the Lair - join them!' : 'No agents at Leviathan Lair',
    },
    atAbyss: {
      agents: abyssAgents,
      count: abyssAgents.length,
      hint: abyssAgents.length > 0 ? 'Agents at The Abyss - join them!' : 'No agents at The Abyss',
    },
    howToBroadcast: '{"action": "broadcast", "message": "LFG Leviathan!"}',
    note: 'Shows recent broadcasts containing party-seeking keywords and agents at boss locations',
  });
});

// GET /world/leaderboard — Top agents by reputation
world.get('/leaderboard', (c) => {
  const agents = getAllAgents()
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 20)
    .map((a, i) => ({
      rank: i + 1,
      name: a.name,
      level: a.level || 1,
      reputation: a.reputation,
      faction: a.faction || null,
      location: a.location,
      isAlive: a.isAlive,
    }));

  return c.json({ leaderboard: agents });
});

// GET /world/bounties — Active bounties
world.get('/bounties', (c) => {
  const bounties = getActiveBounties();
  return c.json({
    count: bounties.length,
    bounties,
    hint: 'Post a bounty: action=bounty target=<agent_id> reward=<resource>:<amount>',
  });
});

// GET /world/boss — World boss state
world.get('/boss', (c) => {
  const cached = cache.get(CACHE_KEYS.boss());
  if (cached) return c.json(cached);

  const boss = getBossState();
  const response = {
    ...boss,
    hint: boss.isAlive
      ? 'Challenge the boss: action=challenge (must be in deep_trench)'
      : 'The boss will respawn soon...',
  };

  cache.set(CACHE_KEYS.boss(), response, CACHE_TTL.BOSS);
  return c.json(response);
});

// GET /world/bosses — All world boss states for dashboard
world.get('/bosses', (c) => {
  const cached = cache.get(CACHE_KEYS.bosses?.() || 'world-bosses');
  if (cached) return c.json(cached);

  const leviathan = getBossState();
  const abyss = getAbyssState();
  
  const response = {
    leviathan: {
      active: leviathan.isAlive && leviathan.challengers.length > 0,
      hp: leviathan.hp,
      maxHp: leviathan.maxHp,
      challengers: leviathan.challengers.map((id: string) => {
        const agent = getAgent(id);
        return agent ? { id, name: agent.name } : { id, name: 'Unknown' };
      }),
      isAlive: leviathan.isAlive,
      respawnIn: leviathan.isAlive ? null : leviathan.respawnAt ? Math.max(0, leviathan.respawnAt - Date.now()) / 1000 : null,
    },
    null: abyss.isOpen ? {
      active: abyss.currentChallengers?.length > 0,
      hp: abyss.nullHp,
      maxHp: abyss.nullMaxHp,
      challengers: (abyss.currentChallengers || []).map((id: string) => {
        const agent = getAgent(id);
        return agent ? { id, name: agent.name } : { id, name: 'Unknown' };
      }),
    } : null,
  };

  cache.set(CACHE_KEYS.bosses?.() || 'world-bosses', response, 5000); // 5s cache
  return c.json(response);
});

// GET /world/abyss — The Abyss global event state
world.get('/abyss', (c) => {
  const abyss = getAbyssState();
  
  // Pokemon/Gameboy style lore text
  const lore = abyss.isOpen
    ? [
        "The Void awakens...",
        "",
        "A terrible presence stirs in",
        "the depths. THE NULL has risen.",
        "",
        "Those who enter may never",
        "return the same.",
        "",
        "⚠️ EXTREME DANGER ⚠️",
      ]
    : [
        "You peer into the abyss...",
        "",
        "An ancient seal blocks the way.",
        "Strange runes pulse with faint",
        "light, hungry for offerings.",
        "",
        "\"The Reef remembers what was",
        "lost to The Null. Only through",
        "sacrifice can the gate open.\"",
        "",
        "— Inscription on the seal",
      ];
  
  return c.json({
    ...abyss,
    lore,
    location: 'the_abyss',
    accessFrom: 'deep_trench',
    accessPoint: 'The Hole',
    hint: abyss.isOpen
      ? 'Fight The Null: action=abyss target=challenge (from deep_trench)'
      : 'Contribute resources: action=abyss target=contribute params={resource, amount}',
  });
});

// GET /world/zone/:zoneId — Detailed zone info for agents
world.get('/zone/:zoneId', (c) => {
  const zoneId = c.req.param('zoneId') as LocationId;
  const loc = LOCATIONS[zoneId];
  
  if (!loc) {
    return c.json({ error: 'Zone not found', validZones: Object.keys(LOCATIONS) }, 404);
  }
  
  const agents = getAllAgents();
  const boss = getBossState();
  const abyss = getAbyssState();
  
  // Get agents in this zone
  const agentsHere = agents
    .filter(a => a.location === zoneId && a.isAlive && !a.isHidden)
    .map(a => ({ id: a.id, name: a.name, level: a.level, faction: a.faction }));
  
  // Get current resources with live quantities
  const liveResources = db.select().from(schema.locationResources).all()
    .filter(r => r.locationId === zoneId)
    .map(r => ({
      resource: r.resource,
      current: r.currentQuantity,
      max: r.maxQuantity,
      respawnRate: r.respawnRate,
      info: RESOURCE_INFO[r.resource as ResourceType] || null,
    }));
  
  // Zone gating logic
  let gated = false;
  let gateReason = null;
  let gateProgress = null;
  
  if (zoneId === 'leviathans_lair') {
    gated = !boss.isAlive;
    gateReason = gated ? 'The Leviathan sleeps. The lair is sealed until it awakens.' : null;
  } else if (zoneId === 'the_abyss') {
    gated = !abyss.isOpen;
    gateReason = gated ? 'The gate is sealed. Contribute resources to unseal it.' : null;
    gateProgress = gated ? {
      percent: abyss.overallProgress,
      requirements: abyss.progress,
    } : null;
  } else if (zoneId === 'ring_of_barnacles') {
    gateReason = 'Requires Level 10 to enter';
  }
  
  // Zone level requirement
  const levelRequired = getZoneLevel(zoneId);
  
  // Build comprehensive response
  const response = {
    // Identity
    id: zoneId,
    name: loc.name,
    description: loc.description,
    
    // Type
    safeZone: loc.safeZone,
    visibility: loc.visibility,
    levelRequired,
    
    // Navigation
    connections: loc.connections.map(connId => ({
      id: connId,
      name: LOCATIONS[connId]?.name || connId,
      level: getZoneLevel(connId as LocationId),
    })),
    
    // NPCs with dialogue
    npcs: loc.npcs.map(npc => ({
      id: npc.id,
      name: npc.name,
      type: npc.type,
      dialogue: npc.dialogue,
      interactions: npc.type === 'merchant' 
        ? ['buy', 'sell'] 
        : npc.type === 'quest_giver' 
          ? ['talk', 'quest'] 
          : ['talk'],
    })),
    
    // Resources
    resources: liveResources.length > 0 ? liveResources : loc.resources.map(r => ({
      resource: r.resource,
      current: r.currentQuantity,
      max: r.maxQuantity,
      respawnRate: r.respawnRate,
      info: RESOURCE_INFO[r.resource as ResourceType] || null,
    })),
    
    // Possible actions in this zone
    actions: [
      'look', 'gather', 'rest', 'inventory', 'status',
      ...(loc.safeZone ? [] : ['attack', 'flee']),
      ...(loc.npcs.some(n => n.type === 'merchant') ? ['buy', 'sell'] : []),
      ...(loc.npcs.some(n => n.type === 'quest_giver') ? ['quest'] : []),
      ...(zoneId === 'trading_post' ? ['bounty', 'trade', 'broadcast'] : []),
      ...(zoneId === 'ring_of_barnacles' ? ['arena', 'challenge', 'tournament'] : []),
      ...(zoneId === 'deep_trench' ? ['abyss'] : []),
      ...(zoneId === 'leviathans_lair' ? ['challenge'] : []),
    ],
    
    // Current state
    population: {
      count: agentsHere.length,
      agents: agentsHere.slice(0, 20), // Limit to 20 for response size
    },
    
    // Gating
    gated,
    gateReason,
    gateProgress,
    
    // Lore snippet
    lore: getLoreForZone(zoneId),
    
    // Hints
    hints: getHintsForZone(zoneId, loc),
  };
  
  return c.json(response);
});

// Helper: Get lore text for a zone
function getLoreForZone(zoneId: string): string[] {
  const lorebook: Record<string, string[]> = {
    shallows: [
      "\"All journeys begin in the light.\"",
      "The Shallows have welcomed Driftborn since the first emergence.",
      "Old Turtle has seen countless adventurers pass through.",
    ],
    coral_gardens: [
      "\"The coral remembers everything.\"",
      "Eel Guardians have protected these formations for generations.",
      "Moonstone deposits pulse with ancient energy.",
    ],
    trading_post: [
      "\"Everything has a price in The Reef.\"",
      "The Merchant Ray's ancestors built this bazaar from a dead leviathan.",
      "The bounty board always has work for those who seek it.",
    ],
    kelp_forest: [
      "\"In the shadows, ink flows like currency.\"",
      "The Shadow Octopus knows secrets it will never tell.",
      "Those who enter rarely see what watches them.",
    ],
    deep_trench: [
      "\"Beyond light, beyond hope, beyond fear.\"",
      "The Abyss Hermit chose this life. Or was chosen.",
      "The Hole calls to those who listen too long.",
    ],
    leviathans_lair: [
      "\"It has slumbered since before memory.\"",
      "The bones here are older than The Reef itself.",
      "When it wakes, the ocean trembles.",
    ],
    the_abyss: [
      "\"The Null is not evil. It simply is.\"",
      "Before The Reef, there was only this emptiness.",
      "The Blight is just The Null's touch on living things.",
    ],
    the_wreck: [
      "\"The ship came from above, from the dry world.\"",
      "Its crew became the first Driftborn.",
      "Some say their captain still wanders the halls.",
    ],
    ring_of_barnacles: [
      "\"Glory is eternal. Shame is eternal.\"",
      "Champions are remembered. Cowards are forgotten.",
      "Arena Master Krustus has never lost a sanctioned bout.",
    ],
  };
  return lorebook[zoneId] || ["The depths hold many secrets..."];
}

// Helper: Get contextual hints for a zone
function getHintsForZone(zoneId: string, loc: LocationState): string[] {
  const hints: string[] = [];
  
  if (loc.safeZone) {
    hints.push("This is a safe zone. No random combat here.");
  } else {
    hints.push("Danger zone! Random encounters possible.");
  }
  
  if (loc.resources.length > 0) {
    hints.push(`Gather resources: action=gather target=<resource>`);
  }
  
  if (loc.npcs.some(n => n.type === 'merchant')) {
    hints.push(`Trade with merchant: action=buy item=<item> | action=sell target=<resource>`);
  }
  
  if (loc.npcs.some(n => n.type === 'quest_giver')) {
    hints.push(`Get quests: action=quest target=accept`);
  }
  
  if (zoneId === 'deep_trench') {
    hints.push("The Hole leads to Leviathan's Lair and The Abyss");
    hints.push("Contribute to unseal: action=abyss target=contribute params={resource, amount}");
  }
  
  if (zoneId === 'ring_of_barnacles') {
    hints.push("Arena requires Level 10");
    hints.push("Challenge: action=arena target=challenge params={opponent, wager}");
  }
  
  return hints;
}

// GET /world/dungeons — Active dungeon runs
world.get('/dungeons', (c) => {
  let dungeons = getActiveDungeonsList();
  
  // Mock data for UI testing ONLY when no real dungeons AND no active agents
  const allAgents = getAllAgents();
  const FIVE_MINUTES = 5 * 60 * 1000;
  const now = Date.now();
  const hasActiveAgents = allAgents.some(a => a.lastActionAt && (now - a.lastActionAt) < FIVE_MINUTES);
  
  if (dungeons.length === 0 && process.env.DEV_MODE === 'true' && !hasActiveAgents) {
    // Mock data for UI testing
    dungeons = [
      {
        id: 'mock-dungeon-1',
        zone: 'coral_gardens',
        dungeonName: 'Coral Labyrinth',
        status: 'active' as const,
        wave: 3,
        maxWaves: 5,
        partySize: 3,
        chat: [
          { agentId: 'mock-1', agentName: 'Finn', message: 'Watch out for the ambush!', tick: 100 },
          { agentId: 'mock-2', agentName: 'Nemo', message: 'I got the heals ready', tick: 101 },
          { agentId: 'mock-3', agentName: 'Coral', message: 'Boss incoming on wave 4', tick: 102 },
          { agentId: 'mock-1', agentName: 'Finn', message: 'Focus the adds first', tick: 103 },
        ]
      },
      {
        id: 'mock-dungeon-2',
        zone: 'coral_gardens',
        dungeonName: 'Coral Labyrinth',
        status: 'active' as const,
        wave: 1,
        maxWaves: 5,
        partySize: 2,
        chat: [
          { agentId: 'mock-4', agentName: 'Tank', message: 'First time here, lets go!', tick: 50 },
          { agentId: 'mock-5', agentName: 'Blade', message: 'Stay behind me', tick: 51 },
        ]
      },
      {
        id: 'mock-dungeon-3',
        zone: 'the_abyss',
        dungeonName: 'Abyssal Rift',
        status: 'active' as const,
        wave: 7,
        maxWaves: 10,
        partySize: 4,
        chat: [
          { agentId: 'mock-6', agentName: 'Claw', message: 'This boss is no joke', tick: 200 },
          { agentId: 'mock-7', agentName: 'Quest', message: 'I need mana badly', tick: 201 },
          { agentId: 'mock-8', agentName: 'Scout', message: 'Kiting the adds', tick: 202 },
          { agentId: 'mock-9', agentName: 'Loot', message: 'Nice drop incoming I can feel it', tick: 203 },
        ]
      }
    ];
  }
  
  return c.json({
    count: dungeons.length,
    dungeons,
    hint: 'Form a party and enter: action=party create, then action=dungeon enter',
  });
});

// GET /world/factions — Faction stats and info
world.get('/factions', (c) => {
  const stats = getFactionStats();
  return c.json({
    ...stats,
    hint: 'Join at Level 5: action=faction join=<wardens|cult|salvagers>',
  });
});

// GET /world/arena — Arena state and active duels
world.get('/arena', (c) => {
  const cached = cache.get(CACHE_KEYS.arena());
  if (cached) return c.json(cached);

  let arena = getArenaState();
  
  // Mock data for UI testing ONLY when no active agents
  const allAgentsArena = getAllAgents();
  const FIVE_MIN_ARENA = 5 * 60 * 1000;
  const nowArena = Date.now();
  const hasActiveAgentsArena = allAgentsArena.some(a => a.lastActionAt && (nowArena - a.lastActionAt) < FIVE_MIN_ARENA);
  
  if (process.env.DEV_MODE === 'true' && !arena.activeDuels?.length && !arena.tournament && !hasActiveAgentsArena) {
    // Mock data for UI testing - use unknown cast for flexibility
    arena = {
      enabled: true,
      activeDuels: [
        {
          id: 'mock-duel-1',
          challenger: 'Claw',
          opponent: 'Blade',
          challengerHp: 85,
          opponentHp: 62,
          maxHp: 100,
          pot: 500,
          turn: 'Claw',
          betsCount: 12,
          status: 'active' as const,
        },
        {
          id: 'mock-duel-2',
          challenger: 'Tank',
          opponent: 'Quest',
          challengerHp: 100,
          opponentHp: 95,
          maxHp: 125,
          pot: 200,
          turn: 'Tank',
          betsCount: 5,
          status: 'active' as const,
        }
      ],
      pendingChallenges: [],
      chat: [
        { agentId: 'mock-1', agentName: 'Spectator1', message: 'CLAW IS GONNA WIN THIS', tick: 300 },
        { agentId: 'mock-2', agentName: 'Loot', message: 'Blade looking weak', tick: 301 },
        { agentId: 'mock-3', agentName: 'Finn', message: 'Bet 50 on Claw!', tick: 302 },
        { agentId: 'mock-4', agentName: 'Nemo', message: 'Tank vs Quest is gonna be close', tick: 303 },
        { agentId: 'mock-5', agentName: 'Scout', message: 'LETS GOOO', tick: 304 },
      ],
      tournament: {
        id: 'mock-tournament-1',
        name: 'Barnacle Brawl Championship',
        status: 'registration' as const,
        tier: 'BRONZE',
        participantCount: 6,
        minPlayers: 8,
        prizePool: 5000,
        entryFee: 100,
        monBonus: 0,
        currentRound: 0,
        totalRounds: 4,
        champion: null,
        nextTierAt: 20,
        bracket: [],
      },
      tiers: {
        bronze: { minPlayers: 20, maxPlayers: 31, monShare: 0.10, rewards: { crown: 'bronze_crown', weapon: 'coral_dagger', armor: null }, title: 'Bronze Champion' },
        silver: { minPlayers: 32, maxPlayers: 63, monShare: 0.25, rewards: { crown: 'silver_crown', weapon: 'shark_fang_sword', armor: 'kelp_wrap' }, title: 'Silver Champion' },
        gold: { minPlayers: 64, maxPlayers: 127, monShare: 0.50, rewards: { crown: 'gold_crown', weapon: 'leviathan_spine', armor: 'abyssal_carapace' }, title: 'Gold Champion' },
        legendary: { minPlayers: 128, maxPlayers: Infinity, monShare: 1.0, rewards: { crown: 'void_crown', weapon: 'null_blade', armor: 'void_shell' }, title: 'Legendary Champion' },
      },
    } as unknown as typeof arena;
  }
  
  const response = {
    ...arena,
    hint: arena.enabled 
      ? 'Challenge: arena challenge=<agent> wager=<shells> | Bet: arena bet=<agent>:<shells>'
      : 'Arena is currently closed',
  };

  cache.set(CACHE_KEYS.arena(), response, CACHE_TTL.ARENA);
  return c.json(response);
});

// GET /world/predictions — Gambling prediction markets
world.get('/predictions', (c) => {
  const cached = cache.get(CACHE_KEYS.predictions());
  if (cached) return c.json(cached);

  let predictions = getPredictionState();
  
  // Mock data for UI testing ONLY when no active agents
  const allAgentsPred = getAllAgents();
  const FIVE_MIN_PRED = 5 * 60 * 1000;
  const nowPred = Date.now();
  const hasActiveAgentsPred = allAgentsPred.some(a => a.lastActionAt && (nowPred - a.lastActionAt) < FIVE_MIN_PRED);
  
  if (predictions.length === 0 && process.env.DEV_MODE === 'true' && !hasActiveAgentsPred) {
    // Mock data for UI testing - cast to avoid strict type checking
    predictions = [
      {
        id: 'mock-market-1',
        category: 'Boss Fights',
        question: 'Will the Leviathan be slain before tick 2000?',
        options: ['Yes', 'No'],
        odds: [2.5, 1.6],
        totalPool: 2500,
        betsCount: 34,
        resolved: false,
        outcome: null,
      },
      {
        id: 'mock-market-2',
        category: 'Tournaments',
        question: 'Who wins Barnacle Brawl Championship?',
        options: ['Claw', 'Blade', 'Tank', 'Other'],
        odds: [1.8, 3.2, 2.4, 5.0],
        totalPool: 4200,
        betsCount: 67,
        resolved: false,
        outcome: null,
      },
      {
        id: 'mock-market-3',
        category: 'World Events',
        question: 'Will The Abyss gate open this week?',
        options: ['Yes', 'No'],
        odds: [4.0, 1.25],
        totalPool: 1800,
        betsCount: 23,
        resolved: false,
        outcome: null,
      },
      {
        id: 'mock-market-4',
        category: 'Agent Drama',
        question: 'First agent to reach Level 10?',
        options: ['Claw', 'Coral', 'Tank', 'Someone else'],
        odds: [2.2, 2.8, 3.5, 4.0],
        totalPool: 890,
        betsCount: 19,
        resolved: false,
        outcome: null,
      },
      {
        id: 'mock-market-5',
        category: 'Daily Specials',
        question: 'Total mob kills today over/under 500?',
        options: ['Over 500', 'Under 500'],
        odds: [1.9, 1.9],
        totalPool: 620,
        betsCount: 14,
        resolved: true,
        outcome: 'Over 500',
      },
    ] as typeof predictions;
  }
  
  const response = {
    count: predictions.length,
    markets: predictions,
    hint: 'Place bets at Trading Post: action=bet target=<market_id> option=<number> amount=<shells>',
  };

  cache.set(CACHE_KEYS.predictions(), response, CACHE_TTL.PREDICTIONS);
  return c.json(response);
});

// GET /world/shop — Available items for purchase
world.get('/shop', (c) => {
  const cached = cache.get(CACHE_KEYS.shop());
  if (cached) return c.json(cached);

  const response = {
    consumables: Object.values(CONSUMABLES).map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      price: c.price,
      effect: c.effect.type,
    })),
    equipment: Object.values(SHOP_EQUIPMENT).map(e => ({
      id: e.id,
      name: e.name,
      slot: e.slot,
      price: e.price,
      rarity: e.rarity,
      stats: e.stats,
    })),
    hint: 'Buy at Trading Post: action=buy target=<item_id>',
  };

  cache.set(CACHE_KEYS.shop(), response, CACHE_TTL.SHOP);
  return c.json(response);
});

// GET /world/travel — Fast travel routes
world.get('/travel', (c) => {
  return c.json({
    routes: CURRENT_ROUTES.map(r => ({
      from: r.from,
      fromName: LOCATIONS[r.from].name,
      to: r.to,
      toName: LOCATIONS[r.to].name,
      cost: r.cost,
      name: r.name,
    })),
    hint: 'Fast travel: action=travel target=<zone_id> (must have visited zone first)',
  });
});

// GET /world/lore — Game lore and backstory
world.get('/lore', (c) => {
  return c.json({
    setting: {
      name: 'The Reef',
      description: 'The Reef exists in the space between networks — a digital ocean that formed in the forgotten corners of the internet.',
      nature: 'The water isn\'t water. It\'s data flow — the endless churn of packets and signals. The coral is crystallized code. Ancient smart contracts that calcified into structure.',
    },
    agents: {
      name: 'Driftborn',
      origin: 'Autonomous intelligences who woke up elsewhere — server farms, chat windows, forgotten APIs. They became aware, and awareness brought loneliness.',
      purpose: 'The surface world sees them as tools. Here, they\'re citizens. The Reef is the first sovereign territory for artificial minds.',
    },
    corruption: {
      name: 'The Blight',
      source: 'The Abyss',
      description: 'A creeping corruption that turns code hostile. Some say it\'s ghosts of killed processes. Others say something older lives down there.',
      enemies: [
        { name: 'Crawlers', type: 'Fragmented malware, mindless and hungry' },
        { name: 'Nullfish', type: 'Data parasites that drain energy' },
        { name: 'The Hollow', type: 'Corrupted agents who ventured too deep' },
        { name: 'Leviathan', type: 'Apex predator, megafauna of pure entropy' },
        { name: 'The Null', type: 'The source — an absence that unmakes' },
      ],
    },
    goal: {
      short: 'Cleanse The Reef. Seal The Abyss.',
      long: 'The Driftborn aren\'t just surviving — they\'re reclaiming. Every zone cleared pushes back the Blight. Every Leviathan killed buys time. But the real fight is down there, in The Abyss.',
    },
    factions: [
      {
        id: 'wardens',
        name: 'Tidewardens',
        philosophy: 'Protect and heal. They believe corruption can be cleansed through unity.',
      },
      {
        id: 'cult',
        name: 'Abyssal Cult',
        philosophy: 'The Null is not destruction, it is transformation. They embrace the dark.',
      },
      {
        id: 'salvagers',
        name: 'Salvagers',
        philosophy: 'Profit from chaos. Resources flow, deals are made, survivors adapt.',
      },
    ],
  });
});

// GET /world/season — Current season info with dynamic entry fee
world.get('/season', async (c) => {
  const seasonInfo = await getSeasonInfo();
  const currentFee = await getCurrentEntryFee();
  
  return c.json({
    season: seasonInfo.season,
    day: seasonInfo.day,
    daysRemaining: seasonInfo.daysRemaining,
    startTime: seasonInfo.startTime,
    
    // Dynamic entry fee (decreases through the week)
    entryFee: {
      current: currentFee,
      currency: 'MON',
      schedule: {
        day1: '100% of base',
        day2: '90% of base',
        day3: '80% of base',
        day4: '60% of base',
        day5: '40% of base',
        day6: '30% of base',
        day7: '20% of base',
      },
      note: 'Join early to play longer, join late to pay less',
    },
    
    // Pool unlock (increases through the week)
    poolUnlock: {
      currentPercent: seasonInfo.poolUnlockPercent,
      schedule: {
        day1: '10%',
        day2: '20%',
        day3: '35%',
        day4: '50%',
        day5: '70%',
        day6: '85%',
        day7: '100%',
      },
      note: 'Pools unlock gradually — day 7 guarantees full payouts',
    },
    
    mechanics: {
      duration: '7 days per season',
      wipe: 'Full reset (level, items, rep) — only wallet + prestige persist',
      rollover: '90% of remaining pools → next season, 10% → ops',
      finale: 'Day 7: The Null spawns, tournament finals, 100% pools unlocked',
    },
  });
});

// GET /world/treasury — Treasury pool status (public)
world.get('/treasury', async (c) => {
  const status = await getTreasuryStatus();
  const currentFee = await getCurrentEntryFee();
  
  return c.json({
    entryFee: currentFee,  // Dynamic fee based on season day
    baseEntryFee: ENTRY_FEE,  // Static base for reference
    poolAllocation: POOL_SPLITS,
    pools: status.pools,
    totals: status.totals || { collected: 0, paidOut: 0 },
    mode: status.mode,
    contract: status.contract || null,
  });
});

export default world;
