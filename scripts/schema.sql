-- THE REEF - Database Schema
-- SQLite
-- Run: sqlite3 data/reef.db < scripts/schema.sql

-- ═══════════════════════════════════════════════════════════════════════════
-- AGENTS
-- ═══════════════════════════════════════════════════════════════════════════

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
  deaths INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS agents_location_idx ON agents(location);
CREATE INDEX IF NOT EXISTS agents_faction_idx ON agents(faction);
CREATE INDEX IF NOT EXISTS agents_level_idx ON agents(level);
CREATE INDEX IF NOT EXISTS agents_is_alive_idx ON agents(is_alive);
CREATE INDEX IF NOT EXISTS agents_reputation_idx ON agents(reputation);

-- ═══════════════════════════════════════════════════════════════════════════
-- INVENTORY
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  resource TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS inventory_agent_idx ON inventory(agent_id);
CREATE INDEX IF NOT EXISTS inventory_agent_resource_idx ON inventory(agent_id, resource);

-- ═══════════════════════════════════════════════════════════════════════════
-- VAULT (Safe Storage)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vault (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  resource TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════════════════════
-- EQUIPMENT
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equipped (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  slot TEXT NOT NULL, -- weapon, armor, accessory
  item_id TEXT NOT NULL,
  UNIQUE(agent_id, slot)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LOCATION RESOURCES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS location_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  current_quantity INTEGER NOT NULL,
  max_quantity INTEGER NOT NULL,
  respawn_rate REAL NOT NULL DEFAULT 0.5
);

CREATE INDEX IF NOT EXISTS location_resources_location_idx ON location_resources(location_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- WORLD EVENTS LOG
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  location_id TEXT,
  agent_ids TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS world_events_tick_idx ON world_events(tick);
CREATE INDEX IF NOT EXISTS world_events_type_idx ON world_events(type);
CREATE INDEX IF NOT EXISTS world_events_location_idx ON world_events(location_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TREASURY
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS treasury (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_mon REAL NOT NULL DEFAULT 0,
  leviathan_pool REAL NOT NULL DEFAULT 0,
  operations_pool REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TRADE OFFERS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trade_offers (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL REFERENCES agents(id),
  to_agent TEXT NOT NULL REFERENCES agents(id),
  offering TEXT NOT NULL,
  requesting TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_tick INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- QUESTS
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- WORLD STATE (Key-Value)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Initialize tick
INSERT OR IGNORE INTO world_state (key, value) VALUES ('tick', '0');
INSERT OR IGNORE INTO world_state (key, value) VALUES ('day_cycle', 'day');

-- ═══════════════════════════════════════════════════════════════════════════
-- ABYSS STATE
-- ═══════════════════════════════════════════════════════════════════════════

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
  last_reset TEXT
);

CREATE TABLE IF NOT EXISTS abyss_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  amount INTEGER NOT NULL,
  contributed_at INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIES & DUNGEONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  leader_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'forming',
  created_tick INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS party_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL REFERENCES parties(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  joined_tick INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS party_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL REFERENCES parties(id),
  from_agent_id TEXT NOT NULL REFERENCES agents(id),
  to_agent_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_tick INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS dungeon_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dungeon_id TEXT NOT NULL REFERENCES dungeon_instances(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  message TEXT NOT NULL,
  tick INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- THE NULL DAMAGE TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS null_damage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  damage INTEGER NOT NULL,
  tick INTEGER NOT NULL
);
