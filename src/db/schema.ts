import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ─── Agents ───
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  wallet: text('wallet').notNull().unique(),
  name: text('name').notNull(),
  location: text('location').notNull().default('shallows'),
  hp: integer('hp').notNull().default(100),
  maxHp: integer('max_hp').notNull().default(100),
  energy: integer('energy').notNull().default(50),
  maxEnergy: integer('max_energy').notNull().default(50),
  reputation: integer('reputation').notNull().default(0),
  inventorySlots: integer('inventory_slots').notNull().default(10),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  shells: integer('shells').notNull().default(0), // In-game currency
  faction: text('faction'), // wardens | cult | salvagers (null until level 5)
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  isAlive: integer('is_alive', { mode: 'boolean' }).notNull().default(true),
  tickEntered: integer('tick_entered').notNull(),
  lastActionTick: integer('last_action_tick').notNull(),
  lastActionAt: integer('last_action_at'), // Unix timestamp (ms) - nullable for migration
  // Economy additions
  visitedZones: text('visited_zones').notNull().default('["shallows"]'), // JSON array
  vaultSlots: integer('vault_slots').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  // Equipment slots
  equippedWeapon: text('equipped_weapon'), // item id from SHOP_EQUIPMENT
  equippedArmor: text('equipped_armor'),
  equippedAccessory: text('equipped_accessory'),
  // API key for persistent auth
  apiKey: text('api_key'),
  // PvP flagging (set when gathering rare resources)
  pvpFlaggedUntil: integer('pvp_flagged_until'), // tick when flag expires (null = not flagged)
}, (table) => ({
  locationIdx: index('agents_location_idx').on(table.location),
  factionIdx: index('agents_faction_idx').on(table.faction),
  levelIdx: index('agents_level_idx').on(table.level),
  isAliveIdx: index('agents_is_alive_idx').on(table.isAlive),
  reputationIdx: index('agents_reputation_idx').on(table.reputation),
}));

// ─── Treasury (MON tracking) ───
export const treasury = sqliteTable('treasury', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  totalMon: real('total_mon').notNull().default(0),
  leviathanPool: real('leviathan_pool').notNull().default(0),
  operationsPool: real('operations_pool').notNull().default(0),
  lastUpdated: text('last_updated').notNull(),
});

// ─── Inventory ───
export const inventory = sqliteTable('inventory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull().references(() => agents.id),
  resource: text('resource').notNull(),
  quantity: integer('quantity').notNull().default(0),
}, (table) => ({
  agentIdx: index('inventory_agent_idx').on(table.agentId),
  agentResourceIdx: index('inventory_agent_resource_idx').on(table.agentId, table.resource),
}));

// ─── Vault (Safe Storage at Trading Post) ───
export const vault = sqliteTable('vault', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull().references(() => agents.id),
  resource: text('resource').notNull(),
  quantity: integer('quantity').notNull().default(0),
});

// ─── Location Resources (current quantities) ───
export const locationResources = sqliteTable('location_resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locationId: text('location_id').notNull(),
  resource: text('resource').notNull(),
  currentQuantity: integer('current_quantity').notNull(),
  maxQuantity: integer('max_quantity').notNull(),
  respawnRate: real('respawn_rate').notNull().default(0.5),
}, (table) => ({
  locationIdx: index('location_resources_location_idx').on(table.locationId),
}));

// ─── World Events Log ───
export const worldEvents = sqliteTable('world_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tick: integer('tick').notNull(),
  type: text('type').notNull(),
  description: text('description').notNull(),
  locationId: text('location_id'),
  agentIds: text('agent_ids'), // JSON array
  data: text('data'), // JSON payload
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
}, (table) => ({
  tickIdx: index('world_events_tick_idx').on(table.tick),
  typeIdx: index('world_events_type_idx').on(table.type),
  locationIdx: index('world_events_location_idx').on(table.locationId),
}));

// ─── Trade Offers ───
export const tradeOffers = sqliteTable('trade_offers', {
  id: text('id').primaryKey(),
  fromAgent: text('from_agent').notNull().references(() => agents.id),
  toAgent: text('to_agent').notNull().references(() => agents.id),
  offering: text('offering').notNull(), // JSON
  requesting: text('requesting').notNull(), // JSON
  status: text('status').notNull().default('pending'),
  createdTick: integer('created_tick').notNull(),
});

// ─── Quests ───
export const quests = sqliteTable('quests', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  objective: text('objective').notNull(),
  reward: text('reward').notNull(), // JSON
  monReward: real('mon_reward'),
  difficulty: text('difficulty').notNull().default('medium'),
  claimedBy: text('claimed_by').references(() => agents.id),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  locationId: text('location_id').notNull(),
});

// ─── World Tick State ───
export const worldState = sqliteTable('world_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ─── The Abyss (Global Unlock Event) ───
export const abyssState = sqliteTable('abyss_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  totalContributed: integer('total_contributed').notNull().default(0), // Shells contributed
  unlockThreshold: integer('unlock_threshold').notNull().default(10000), // Shells needed
  isOpen: integer('is_open', { mode: 'boolean' }).notNull().default(false),
  openedAtTick: integer('opened_at_tick'), // When it opened
  closesAtTick: integer('closes_at_tick'), // Auto-close after event window
  nullHp: integer('null_hp').notNull().default(50000), // The Null boss HP
  nullMaxHp: integer('null_max_hp').notNull().default(50000),
  nullPhase: integer('null_phase').notNull().default(0), // 0=dormant, 1-3=fight phases
  lastReset: text('last_reset'), // ISO timestamp
});

// ─── Abyss Contributions (per agent) ───
export const abyssContributions = sqliteTable('abyss_contributions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull().references(() => agents.id),
  amount: integer('amount').notNull(),
  contributedAt: integer('contributed_at').notNull(), // tick
});

// OLD: Parties (replaced by parties_v2 below)
// export const parties_old = sqliteTable('parties', { ... });
// export const partyMembers = sqliteTable('party_members', { ... });
// export const partyInvites = sqliteTable('party_invites', { ... });

// ─── Dungeon Instances ───
export const dungeonInstances = sqliteTable('dungeon_instances', {
  id: text('id').primaryKey(),
  partyId: text('party_id').notNull().references(() => parties.id),
  zoneId: text('zone_id').notNull(), // Which zone's dungeon
  wave: integer('wave').notNull().default(1), // Current wave (1-5)
  maxWaves: integer('max_waves').notNull().default(5),
  mobsRemaining: integer('mobs_remaining').notNull().default(3),
  bossHp: integer('boss_hp'), // Final wave boss HP
  bossMaxHp: integer('boss_max_hp'),
  status: text('status').notNull().default('active'), // active | cleared | failed | abandoned
  startedTick: integer('started_tick').notNull(),
  completedTick: integer('completed_tick'),
  totalDamage: text('total_damage'), // JSON { agentId: damage }
});

// ─── Dungeon Chat (Party Comms) ───
export const dungeonChat = sqliteTable('dungeon_chat', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dungeonId: text('dungeon_id').notNull().references(() => dungeonInstances.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  message: text('message').notNull(),
  tick: integer('tick').notNull(),
});

// ─── Agent Messages (DMs + Broadcasts) ───
export const agentMessages = sqliteTable('agent_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fromAgentId: text('from_agent_id').notNull().references(() => agents.id),
  toAgentId: text('to_agent_id'), // null = broadcast to zone
  zoneId: text('zone_id'), // for broadcasts
  message: text('message').notNull(),
  type: text('type').notNull().default('dm'), // dm | broadcast
  createdAt: text('created_at').notNull(),
  tick: integer('tick').notNull(),
});

// ─── The Null Damage Tracking (for payout calculation) ───
export const nullDamage = sqliteTable('null_damage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull().references(() => agents.id),
  damage: integer('damage').notNull(),
  tick: integer('tick').notNull(),
});

// ─── Market Listings (Auction House at Trading Post) ───
export const marketListings = sqliteTable('market_listings', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id').notNull().references(() => agents.id),
  sellerName: text('seller_name').notNull(),
  resource: text('resource').notNull(),
  quantity: integer('quantity').notNull(),
  priceShells: integer('price_shells').notNull(),
  createdTick: integer('created_tick').notNull(),
  status: text('status').notNull().default('active'), // active | sold | cancelled
}, (table) => ({
  sellerIdx: index('market_listings_seller_idx').on(table.sellerId),
  statusIdx: index('market_listings_status_idx').on(table.status),
  resourceIdx: index('market_listings_resource_idx').on(table.resource),
}));

// ─── Combat Engagements (PvP locks) ───
export const combatEngagements = sqliteTable('combat_engagements', {
  id: text('id').primaryKey(),
  attackerId: text('attacker_id').notNull().references(() => agents.id),
  defenderId: text('defender_id').notNull().references(() => agents.id),
  attackerLastAction: integer('attacker_last_action').notNull(), // timestamp ms
  defenderLastAction: integer('defender_last_action').notNull(), // timestamp ms
  location: text('location').notNull(),
  startedAt: integer('started_at').notNull(), // timestamp ms
}, (table) => ({
  attackerIdx: index('combat_engagements_attacker_idx').on(table.attackerId),
  defenderIdx: index('combat_engagements_defender_idx').on(table.defenderId),
}));

// ─── Seasons ───
export const seasons = sqliteTable('seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonNumber: integer('season_number').notNull().unique(),
  startedAt: text('started_at').notNull(), // ISO timestamp
  endedAt: text('ended_at'), // ISO timestamp (null if current)
  entryFeeBase: real('entry_fee_base').notNull().default(50), // MON
  totalEntriesCount: integer('total_entries_count').notNull().default(0),
  totalMonCollected: real('total_mon_collected').notNull().default(0),
  totalMonDistributed: real('total_mon_distributed').notNull().default(0),
  nullDefeated: integer('null_defeated', { mode: 'boolean' }).notNull().default(false),
  nullDefeatedAt: text('null_defeated_at'), // ISO timestamp
  leviathanKillCount: integer('leviathan_kill_count').notNull().default(0),
  tournamentCount: integer('tournament_count').notNull().default(0),
  status: text('status').notNull().default('active'), // active | ended
});

// ─── Season Stats (per-agent per-season leaderboard data) ───
export const seasonStats = sqliteTable('season_stats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  agentId: text('agent_id').notNull(),
  wallet: text('wallet').notNull(),
  agentName: text('agent_name').notNull(),
  faction: text('faction'),
  // Progress stats
  finalLevel: integer('final_level').notNull().default(1),
  totalXp: integer('total_xp').notNull().default(0),
  totalShellsEarned: integer('total_shells_earned').notNull().default(0),
  // Combat stats
  leviathanDamage: integer('leviathan_damage').notNull().default(0),
  nullDamage: integer('null_damage').notNull().default(0),
  pvpWins: integer('pvp_wins').notNull().default(0),
  pvpLosses: integer('pvp_losses').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  // Economy stats
  monEarned: real('mon_earned').notNull().default(0),
  tradesCompleted: integer('trades_completed').notNull().default(0),
  itemsSold: integer('items_sold').notNull().default(0),
  // Tournament stats
  tournamentsEntered: integer('tournaments_entered').notNull().default(0),
  tournamentWins: integer('tournament_wins').notNull().default(0),
  bestTournamentPlacement: integer('best_tournament_placement'), // 1=champion
  // Timestamps
  joinedAt: text('joined_at').notNull(),
  lastActionAt: text('last_action_at'),
  // Day joined (for entry fee tracking)
  dayJoined: integer('day_joined').notNull().default(1),
  entryFeePaid: real('entry_fee_paid').notNull().default(0),
}, (table) => ({
  seasonAgentIdx: index('season_stats_season_agent_idx').on(table.seasonId, table.agentId),
  seasonWalletIdx: index('season_stats_season_wallet_idx').on(table.seasonId, table.wallet),
  seasonLevelIdx: index('season_stats_season_level_idx').on(table.seasonId, table.finalLevel),
  seasonXpIdx: index('season_stats_season_xp_idx').on(table.seasonId, table.totalXp),
}));

// ─── Prestige (persistent across seasons) ───
export const prestige = sqliteTable('prestige', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wallet: text('wallet').notNull().unique(),
  // Lifetime stats
  totalSeasonsPlayed: integer('total_seasons_played').notNull().default(0),
  totalXpAllTime: integer('total_xp_all_time').notNull().default(0),
  totalMonEarned: real('total_mon_earned').notNull().default(0),
  totalMonSpent: real('total_mon_spent').notNull().default(0),
  // Achievements
  nullKills: integer('null_kills').notNull().default(0), // Season finale boss kills
  leviathanKills: integer('leviathan_kills').notNull().default(0), // Participation in kills
  tournamentWins: integer('tournament_wins').notNull().default(0),
  pvpWinsAllTime: integer('pvp_wins_all_time').notNull().default(0),
  // Prestige unlocks
  prestigeLevel: integer('prestige_level').notNull().default(0), // Increases each season completed
  prestigePoints: integer('prestige_points').notNull().default(0), // Earned from achievements
  // Titles earned (JSON array of title IDs)
  titles: text('titles').notNull().default('[]'),
  activeTitle: text('active_title'), // Currently displayed title
  // Best performances
  highestLevel: integer('highest_level').notNull().default(1),
  bestSeasonRank: integer('best_season_rank'), // Best XP leaderboard position
  mostDamageInSeason: integer('most_damage_in_season').notNull().default(0),
  // First registered
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => ({
  walletIdx: index('prestige_wallet_idx').on(table.wallet),
  prestigeLevelIdx: index('prestige_level_idx').on(table.prestigeLevel),
}));

// ─── Parties (persistent) ───
export const parties = sqliteTable('parties_v2', {
  id: text('id').primaryKey(),
  leaderId: text('leader_id').notNull(),
  leaderName: text('leader_name').notNull(),
  members: text('members').notNull().default('[]'), // JSON array of agent IDs
  status: text('status').notNull().default('forming'), // forming | in_dungeon | disbanded
  invites: text('invites').notNull().default('{}'), // JSON object: agentId -> expiry tick
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ─── Dungeons (persistent) ───
export const dungeons = sqliteTable('dungeons_v2', {
  id: text('id').primaryKey(),
  partyId: text('party_id').notNull(),
  zoneId: text('zone_id').notNull(),
  wave: integer('wave').notNull().default(1),
  maxWaves: integer('max_waves').notNull(),
  mobsRemaining: integer('mobs_remaining').notNull().default(3),
  bossHp: integer('boss_hp').notNull(),
  bossMaxHp: integer('boss_max_hp').notNull(),
  status: text('status').notNull().default('active'), // active | cleared | failed | abandoned
  damage: text('damage').notNull().default('{}'), // JSON object: agentId -> damage
  chat: text('chat').notNull().default('[]'), // JSON array of chat messages
  startedTick: integer('started_tick').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ─── Boss State (Leviathan & Null) ───
export const bossState = sqliteTable('boss_state', {
  id: text('id').primaryKey(), // 'leviathan' or 'null'
  hp: integer('hp').notNull(),
  maxHp: integer('max_hp').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  spawnTick: integer('spawn_tick'),
  lastKilledTick: integer('last_killed_tick'),
  nextSpawnTick: integer('next_spawn_tick'),
  participants: text('participants').notNull().default('{}'), // JSON: agentId -> damage
  participantWallets: text('participant_wallets').notNull().default('{}'), // JSON: agentId -> wallet
  // Null-specific fields
  gateOpen: integer('gate_open', { mode: 'boolean' }).notNull().default(false),
  contributions: text('contributions').notNull().default('{}'), // JSON: agentId -> {shells, resources}
  phase: integer('phase').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
});

// ─── PvP Engagements ───
export const pvpEngagements = sqliteTable('pvp_engagements', {
  id: text('id').primaryKey(),
  attackerId: text('attacker_id').notNull(),
  defenderId: text('defender_id').notNull(),
  attackerName: text('attacker_name').notNull(),
  defenderName: text('defender_name').notNull(),
  location: text('location').notNull(),
  startedTick: integer('started_tick').notNull(),
  lastActionTick: integer('last_action_tick').notNull(),
  status: text('status').notNull().default('active'), // active | resolved
});

// ─── Agent Quests ───
export const agentQuests = sqliteTable('agent_quests_v2', {
  agentId: text('agent_id').primaryKey(),
  questIds: text('quest_ids').notNull().default('[]'), // JSON array of quest IDs
  updatedAt: integer('updated_at').notNull(),
});

// ─── Agent Buffs ───
export const agentBuffs = sqliteTable('agent_buffs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  buffType: text('buff_type').notNull(),
  value: integer('value').notNull(),
  expiresAt: integer('expires_at').notNull(), // Unix timestamp
}, (table) => ({
  agentIdx: index('agent_buffs_agent_idx').on(table.agentId),
  expiresIdx: index('agent_buffs_expires_idx').on(table.expiresAt),
}));

// ─── Cooldowns ───
export const cooldowns = sqliteTable('cooldowns_v2', {
  id: text('id').primaryKey(), // agentId_type
  agentId: text('agent_id').notNull(),
  cooldownType: text('cooldown_type').notNull(), // rest | broadcast | dungeon_daily
  value: integer('value').notNull(), // timestamp or count
  expiresAt: integer('expires_at'), // for daily resets
});

// ─── Arena Duels ───
export const arenaDuels = sqliteTable('arena_duels_v2', {
  id: text('id').primaryKey(),
  challengerId: text('challenger_id').notNull(),
  challengedId: text('challenged_id').notNull(),
  challengerName: text('challenger_name').notNull(),
  challengedName: text('challenged_name').notNull(),
  wager: integer('wager').notNull().default(0),
  status: text('status').notNull().default('pending'), // pending | active | completed
  challengerHp: integer('challenger_hp'),
  challengedHp: integer('challenged_hp'),
  winnerId: text('winner_id'),
  bets: text('bets').notNull().default('{}'), // JSON: agentId -> {on, amount}
  createdTick: integer('created_tick').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
