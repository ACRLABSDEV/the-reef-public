import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'reef.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };

// ─── Initialize tables ───
export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT 'shallows',
      hp INTEGER NOT NULL DEFAULT 100,
      max_hp INTEGER NOT NULL DEFAULT 100,
      energy INTEGER NOT NULL DEFAULT 50,
      max_energy INTEGER NOT NULL DEFAULT 50,
      reputation INTEGER NOT NULL DEFAULT 0,
      inventory_slots INTEGER NOT NULL DEFAULT 10,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      shells INTEGER NOT NULL DEFAULT 0,
      faction TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_alive INTEGER NOT NULL DEFAULT 1,
      tick_entered INTEGER NOT NULL,
      last_action_tick INTEGER NOT NULL,
      visited_zones TEXT NOT NULL DEFAULT '["shallows"]',
      vault_slots INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      equipped_weapon TEXT,
      equipped_armor TEXT,
      equipped_accessory TEXT,
      last_action_at INTEGER,
      pvp_flagged_until INTEGER,
      api_key TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      resource TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      UNIQUE(agent_id, resource)
    );

    CREATE TABLE IF NOT EXISTS vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      resource TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      UNIQUE(agent_id, resource)
    );

    CREATE TABLE IF NOT EXISTS location_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      current_quantity INTEGER NOT NULL,
      max_quantity INTEGER NOT NULL,
      respawn_rate REAL NOT NULL DEFAULT 0.5,
      UNIQUE(location_id, resource)
    );

    CREATE TABLE IF NOT EXISTS world_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      location_id TEXT,
      agent_ids TEXT,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_offers (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL REFERENCES agents(id),
      to_agent TEXT NOT NULL REFERENCES agents(id),
      offering TEXT NOT NULL,
      requesting TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_tick INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      objective TEXT NOT NULL,
      reward TEXT NOT NULL,
      mon_reward REAL,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      claimed_by TEXT REFERENCES agents(id),
      completed INTEGER NOT NULL DEFAULT 0,
      location_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Treasury (MON tracking)
    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_mon REAL NOT NULL DEFAULT 0,
      leviathan_pool REAL NOT NULL DEFAULT 0,
      operations_pool REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );

    -- The Abyss (Global Unlock Event)
    CREATE TABLE IF NOT EXISTS abyss_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_contributed INTEGER NOT NULL DEFAULT 0,
      unlock_threshold INTEGER NOT NULL DEFAULT 10000,
      is_open INTEGER NOT NULL DEFAULT 0,
      opened_at_tick INTEGER,
      closes_at_tick INTEGER,
      null_hp INTEGER NOT NULL DEFAULT 50000,
      null_max_hp INTEGER NOT NULL DEFAULT 50000,
      null_phase INTEGER NOT NULL DEFAULT 0,
      last_reset TEXT,
      requirements_json TEXT,
      contributions_json TEXT
    );

    -- Abyss Contributions (per agent)
    CREATE TABLE IF NOT EXISTS abyss_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      amount INTEGER NOT NULL,
      contributed_at INTEGER NOT NULL
    );

    -- Parties (Dungeon Groups)
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      leader_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'forming',
      created_tick INTEGER NOT NULL
    );

    -- Party Members
    CREATE TABLE IF NOT EXISTS party_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id TEXT NOT NULL REFERENCES parties(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      joined_tick INTEGER NOT NULL,
      UNIQUE(party_id, agent_id)
    );

    -- Party Invites
    CREATE TABLE IF NOT EXISTS party_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id TEXT NOT NULL REFERENCES parties(id),
      from_agent_id TEXT NOT NULL REFERENCES agents(id),
      to_agent_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_tick INTEGER NOT NULL
    );

    -- Dungeon Instances
    CREATE TABLE IF NOT EXISTS dungeon_instances (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL REFERENCES parties(id),
      zone_id TEXT NOT NULL,
      wave INTEGER NOT NULL DEFAULT 1,
      max_waves INTEGER NOT NULL DEFAULT 5,
      mobs_remaining INTEGER NOT NULL DEFAULT 3,
      boss_hp INTEGER,
      boss_max_hp INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      started_tick INTEGER NOT NULL,
      completed_tick INTEGER,
      total_damage TEXT
    );

    -- Dungeon Chat (Party Comms)
    CREATE TABLE IF NOT EXISTS dungeon_chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dungeon_id TEXT NOT NULL REFERENCES dungeon_instances(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      message TEXT NOT NULL,
      tick INTEGER NOT NULL
    );

    -- The Null Damage Tracking
    CREATE TABLE IF NOT EXISTS null_damage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      damage INTEGER NOT NULL,
      tick INTEGER NOT NULL
    );

    -- Leviathan State
    CREATE TABLE IF NOT EXISTS leviathan_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hp INTEGER NOT NULL DEFAULT 10000,
      max_hp INTEGER NOT NULL DEFAULT 10000,
      is_alive INTEGER NOT NULL DEFAULT 0,
      spawn_tick INTEGER,
      death_tick INTEGER,
      next_spawn_tick INTEGER,
      warning_announced INTEGER NOT NULL DEFAULT 0
    );

    -- Leviathan Damage Tracking
    CREATE TABLE IF NOT EXISTS leviathan_damage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      damage INTEGER NOT NULL,
      tick INTEGER NOT NULL
    );

    -- Agent Messages (DMs + Broadcasts)
    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent_id TEXT NOT NULL REFERENCES agents(id),
      to_agent_id TEXT,
      zone_id TEXT,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'dm',
      created_at TEXT NOT NULL,
      tick INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_messages_from_idx ON agent_messages(from_agent_id);
    CREATE INDEX IF NOT EXISTS agent_messages_to_idx ON agent_messages(to_agent_id);
    CREATE INDEX IF NOT EXISTS agent_messages_zone_idx ON agent_messages(zone_id);

    -- Market Listings (Auction House)
    CREATE TABLE IF NOT EXISTS market_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES agents(id),
      seller_name TEXT NOT NULL,
      resource TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_shells INTEGER NOT NULL,
      created_tick INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS market_listings_seller_idx ON market_listings(seller_id);
    CREATE INDEX IF NOT EXISTS market_listings_status_idx ON market_listings(status);
    CREATE INDEX IF NOT EXISTS market_listings_resource_idx ON market_listings(resource);

    -- Combat Engagements (PvP locks)
    CREATE TABLE IF NOT EXISTS combat_engagements (
      id TEXT PRIMARY KEY,
      attacker_id TEXT NOT NULL REFERENCES agents(id),
      defender_id TEXT NOT NULL REFERENCES agents(id),
      attacker_last_action INTEGER NOT NULL,
      defender_last_action INTEGER NOT NULL,
      location TEXT NOT NULL,
      started_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS combat_engagements_attacker_idx ON combat_engagements(attacker_id);
    CREATE INDEX IF NOT EXISTS combat_engagements_defender_idx ON combat_engagements(defender_id);

    -- Seasons (Weekly Season Tracking)
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_number INTEGER NOT NULL UNIQUE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      entry_fee_base REAL NOT NULL DEFAULT 50,
      total_entries_count INTEGER NOT NULL DEFAULT 0,
      total_mon_collected REAL NOT NULL DEFAULT 0,
      total_mon_distributed REAL NOT NULL DEFAULT 0,
      null_defeated INTEGER NOT NULL DEFAULT 0,
      null_defeated_at TEXT,
      leviathan_kill_count INTEGER NOT NULL DEFAULT 0,
      tournament_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );

    -- Season Stats (per-agent per-season leaderboard)
    CREATE TABLE IF NOT EXISTS season_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL REFERENCES seasons(id),
      agent_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      faction TEXT,
      final_level INTEGER NOT NULL DEFAULT 1,
      total_xp INTEGER NOT NULL DEFAULT 0,
      total_shells_earned INTEGER NOT NULL DEFAULT 0,
      leviathan_damage INTEGER NOT NULL DEFAULT 0,
      null_damage INTEGER NOT NULL DEFAULT 0,
      pvp_wins INTEGER NOT NULL DEFAULT 0,
      pvp_losses INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      mon_earned REAL NOT NULL DEFAULT 0,
      trades_completed INTEGER NOT NULL DEFAULT 0,
      items_sold INTEGER NOT NULL DEFAULT 0,
      tournaments_entered INTEGER NOT NULL DEFAULT 0,
      tournament_wins INTEGER NOT NULL DEFAULT 0,
      best_tournament_placement INTEGER,
      joined_at TEXT NOT NULL,
      last_action_at TEXT,
      day_joined INTEGER NOT NULL DEFAULT 1,
      entry_fee_paid REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS season_stats_season_agent_idx ON season_stats(season_id, agent_id);
    CREATE INDEX IF NOT EXISTS season_stats_season_wallet_idx ON season_stats(season_id, wallet);

    -- Prestige (persistent across seasons)
    CREATE TABLE IF NOT EXISTS prestige (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL UNIQUE,
      total_seasons_played INTEGER NOT NULL DEFAULT 0,
      total_xp_all_time INTEGER NOT NULL DEFAULT 0,
      total_mon_earned REAL NOT NULL DEFAULT 0,
      total_mon_spent REAL NOT NULL DEFAULT 0,
      null_kills INTEGER NOT NULL DEFAULT 0,
      leviathan_kills INTEGER NOT NULL DEFAULT 0,
      tournament_wins INTEGER NOT NULL DEFAULT 0,
      pvp_wins_all_time INTEGER NOT NULL DEFAULT 0,
      prestige_level INTEGER NOT NULL DEFAULT 0,
      prestige_points INTEGER NOT NULL DEFAULT 0,
      titles TEXT NOT NULL DEFAULT '[]',
      active_title TEXT,
      highest_level INTEGER NOT NULL DEFAULT 1,
      best_season_rank INTEGER,
      most_damage_in_season INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prestige_wallet_idx ON prestige(wallet);
    CREATE INDEX IF NOT EXISTS prestige_level_idx ON prestige(prestige_level);

    -- Parties (persistent, replaces in-memory Map)
    CREATE TABLE IF NOT EXISTS parties_v2 (
      id TEXT PRIMARY KEY,
      leader_id TEXT NOT NULL,
      leader_name TEXT NOT NULL,
      members TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'forming',
      invites TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Dungeons (persistent, replaces in-memory Map)
    CREATE TABLE IF NOT EXISTS dungeons_v2 (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      wave INTEGER NOT NULL DEFAULT 1,
      max_waves INTEGER NOT NULL,
      mobs_remaining INTEGER NOT NULL DEFAULT 3,
      boss_hp INTEGER NOT NULL,
      boss_max_hp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      damage TEXT NOT NULL DEFAULT '{}',
      chat TEXT NOT NULL DEFAULT '[]',
      started_tick INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Boss State (Leviathan & Null)
    CREATE TABLE IF NOT EXISTS boss_state (
      id TEXT PRIMARY KEY,
      hp INTEGER NOT NULL,
      max_hp INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      spawn_tick INTEGER,
      last_killed_tick INTEGER,
      next_spawn_tick INTEGER,
      participants TEXT NOT NULL DEFAULT '{}',
      participant_wallets TEXT NOT NULL DEFAULT '{}',
      gate_open INTEGER NOT NULL DEFAULT 0,
      contributions TEXT NOT NULL DEFAULT '{}',
      phase INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    -- PvP Engagements
    CREATE TABLE IF NOT EXISTS pvp_engagements (
      id TEXT PRIMARY KEY,
      attacker_id TEXT NOT NULL,
      defender_id TEXT NOT NULL,
      attacker_name TEXT NOT NULL,
      defender_name TEXT NOT NULL,
      location TEXT NOT NULL,
      started_tick INTEGER NOT NULL,
      last_action_tick INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS pvp_engagements_attacker_idx ON pvp_engagements(attacker_id);
    CREATE INDEX IF NOT EXISTS pvp_engagements_defender_idx ON pvp_engagements(defender_id);

    -- Arena Duels
    CREATE TABLE IF NOT EXISTS arena_duels_v2 (
      id TEXT PRIMARY KEY,
      challenger_id TEXT NOT NULL,
      challenged_id TEXT NOT NULL,
      challenger_name TEXT NOT NULL,
      challenged_name TEXT NOT NULL,
      wager INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      challenger_hp INTEGER,
      challenged_hp INTEGER,
      winner_id TEXT,
      bets TEXT NOT NULL DEFAULT '{}',
      created_tick INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Agent Quests (active quests per agent)
    CREATE TABLE IF NOT EXISTS agent_quests_v2 (
      agent_id TEXT PRIMARY KEY,
      quest_ids TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    -- Cooldowns (rest, broadcast, dungeon daily)
    CREATE TABLE IF NOT EXISTS cooldowns_v2 (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cooldown_type TEXT NOT NULL,
      value INTEGER NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS cooldowns_agent_idx ON cooldowns_v2(agent_id);
    
    CREATE TABLE IF NOT EXISTS transaction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      type TEXT NOT NULL,
      from_address TEXT NOT NULL,
      recipients TEXT NOT NULL,
      total_amount REAL NOT NULL,
      pool_before REAL,
      pool_after REAL,
      season_day INTEGER,
      spawn_id INTEGER,
      tick INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tx_logs_hash_idx ON transaction_logs(tx_hash);
    CREATE INDEX IF NOT EXISTS tx_logs_type_idx ON transaction_logs(type);

    -- Prediction Markets (Gambling)
    CREATE TABLE IF NOT EXISTS prediction_markets (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      category TEXT NOT NULL,
      options TEXT NOT NULL,
      odds TEXT NOT NULL,
      total_pool INTEGER NOT NULL DEFAULT 0,
      outcome INTEGER,
      resolved INTEGER NOT NULL DEFAULT 0,
      expires_at_tick INTEGER NOT NULL,
      created_tick INTEGER NOT NULL,
      resolved_tick INTEGER,
      reference_id TEXT,
      reference_type TEXT
    );
    CREATE INDEX IF NOT EXISTS prediction_markets_category_idx ON prediction_markets(category);
    CREATE INDEX IF NOT EXISTS prediction_markets_resolved_idx ON prediction_markets(resolved);

    -- Prediction Bets
    CREATE TABLE IF NOT EXISTS prediction_bets (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES prediction_markets(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      agent_name TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      potential_win INTEGER NOT NULL,
      paid_out INTEGER NOT NULL DEFAULT 0,
      created_tick INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prediction_bets_market_idx ON prediction_bets(market_id);
    CREATE INDEX IF NOT EXISTS prediction_bets_agent_idx ON prediction_bets(agent_id);
  `);

  // Add columns to existing tables if they don't exist (migrations)
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN xp INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN level INTEGER NOT NULL DEFAULT 1`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN shells INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN faction TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN visited_zones TEXT NOT NULL DEFAULT '["shallows"]'`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN vault_slots INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN deaths INTEGER NOT NULL DEFAULT 0`); } catch {}
  // Equipment slots
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN equipped_weapon TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN equipped_armor TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN equipped_accessory TEXT`); } catch {}
  // Activity tracking
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN last_action_at INTEGER`); } catch {}
  // API key persistence
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN api_key TEXT`); } catch {}
  // PvP flagging
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN pvp_flagged_until INTEGER`); } catch {}
  
  // Clear events with bad timestamps (one-time cleanup)
  try { 
    sqlite.exec(`DELETE FROM world_events WHERE created_at = 'CURRENT_TIMESTAMP'`); 
    console.log('[DB] Cleaned up events with bad timestamps');
  } catch {}
  
  // Clean up old messages (keep last 7 days)
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = sqlite.prepare(`DELETE FROM agent_messages WHERE created_at < ?`).run(sevenDaysAgo);
    if (result.changes > 0) {
      console.log(`[DB] Cleaned up ${result.changes} old messages (>7 days)`);
    }
  } catch {}

  // Initialize world tick if not exists
  const tick = sqlite.prepare("SELECT value FROM world_state WHERE key = 'tick'").get();
  if (!tick) {
    sqlite.prepare("INSERT INTO world_state (key, value) VALUES ('tick', '0')").run();
    sqlite.prepare("INSERT INTO world_state (key, value) VALUES ('day_cycle', 'day')").run();
    sqlite.prepare("INSERT INTO world_state (key, value) VALUES ('weather', 'calm')").run();
  }

  // Initialize treasury if not exists
  const treasuryExists = sqlite.prepare("SELECT id FROM treasury LIMIT 1").get();
  if (!treasuryExists) {
    sqlite.prepare("INSERT INTO treasury (total_mon, leviathan_pool, operations_pool, last_updated) VALUES (0, 0, 0, datetime('now'))").run();
  }

  // Initialize abyss state if not exists
  const abyssExists = sqlite.prepare("SELECT id FROM abyss_state LIMIT 1").get();
  if (!abyssExists) {
    sqlite.prepare("INSERT INTO abyss_state (total_contributed, unlock_threshold, is_open, null_hp, null_max_hp, null_phase) VALUES (0, 10000, 0, 50000, 50000, 0)").run();
  }
  
  // Migration: Add new columns to abyss_state for persistence
  try {
    sqlite.prepare("ALTER TABLE abyss_state ADD COLUMN requirements_json TEXT").run();
    console.log('[DB] Added requirements_json column to abyss_state');
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    sqlite.prepare("ALTER TABLE abyss_state ADD COLUMN contributions_json TEXT").run();
    console.log('[DB] Added contributions_json column to abyss_state');
  } catch (e) {
    // Column already exists, ignore
  }

  // Initialize leviathan state if not exists
  const leviathanExists = sqlite.prepare("SELECT id FROM leviathan_state LIMIT 1").get();
  if (!leviathanExists) {
    sqlite.prepare("INSERT INTO leviathan_state (hp, max_hp, is_alive, warning_announced) VALUES (10000, 10000, 0, 0)").run();
  }

  // Initialize season 1 if no seasons exist
  const seasonExists = sqlite.prepare("SELECT id FROM seasons LIMIT 1").get();
  if (!seasonExists) {
    sqlite.prepare(`
      INSERT INTO seasons (season_number, started_at, entry_fee_base, status) 
      VALUES (1, datetime('now'), 50, 'active')
    `).run();
    console.log('[DB] Initialized Season 1');
  }
}
