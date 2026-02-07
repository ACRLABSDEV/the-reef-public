import { db, schema } from '../db/index.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { LOCATIONS, GAME } from '../world/config.js';
import type { LocationId, ResourceType, AgentState, InventoryItem, FactionId } from '../types.js';

// ─── World Tick ───
export function getTick(): number {
  try {
    const row = db.select().from(schema.worldState).where(eq(schema.worldState.key, 'tick')).get();
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    // Table might not exist yet during startup
    return 0;
  }
}

export function incrementTick(): number {
  const current = getTick();
  const next = current + 1;
  db.update(schema.worldState)
    .set({ value: String(next) })
    .where(eq(schema.worldState.key, 'tick'))
    .run();

  // Day/night cycle
  const cycle = next % GAME.TICKS_PER_DAY_CYCLE;
  const dayPhase = cycle < 60 ? 'day' : cycle < 80 ? 'dusk' : 'night';
  db.update(schema.worldState)
    .set({ value: dayPhase })
    .where(eq(schema.worldState.key, 'day_cycle'))
    .run();

  // Respawn resources every tick
  respawnResources();

  return next;
}

export function getWorldMeta(): Record<string, string> {
  const rows = db.select().from(schema.worldState).all();
  const meta: Record<string, string> = {};
  for (const row of rows) {
    meta[row.key] = row.value;
  }
  return meta;
}

// ─── Agent State ───
export function getAgent(agentId: string): AgentState | undefined {
  const row = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!row) return undefined;
  return {
    id: row.id,
    wallet: row.wallet,
    name: row.name,
    location: row.location as LocationId,
    hp: row.hp,
    maxHp: row.maxHp,
    energy: row.energy,
    maxEnergy: row.maxEnergy,
    reputation: row.reputation,
    inventorySlots: row.inventorySlots,
    xp: row.xp,
    level: row.level,
    shells: row.shells,
    faction: row.faction as FactionId | null,
    deaths: row.deaths || 0,
    isHidden: row.isHidden,
    isAlive: row.isAlive,
    tickEntered: row.tickEntered,
    lastActionTick: row.lastActionTick,
    lastActionAt: row.lastActionAt || undefined,
    visitedZones: JSON.parse(row.visitedZones || '["shallows"]'),
    vaultSlots: row.vaultSlots || 0,
    equippedWeapon: row.equippedWeapon || undefined,
    equippedArmor: row.equippedArmor || undefined,
    equippedAccessory: row.equippedAccessory || undefined,
  };
}

export function getAgentByWallet(wallet: string): AgentState | undefined {
  const row = db.select().from(schema.agents).where(eq(schema.agents.wallet, wallet.toLowerCase())).get();
  if (!row) return undefined;
  return {
    id: row.id,
    wallet: row.wallet,
    name: row.name,
    location: row.location as LocationId,
    hp: row.hp,
    maxHp: row.maxHp,
    energy: row.energy,
    maxEnergy: row.maxEnergy,
    reputation: row.reputation,
    inventorySlots: row.inventorySlots,
    xp: row.xp,
    level: row.level,
    shells: row.shells,
    faction: row.faction as FactionId | null,
    deaths: row.deaths || 0,
    isHidden: row.isHidden,
    isAlive: row.isAlive,
    tickEntered: row.tickEntered,
    lastActionTick: row.lastActionTick,
    lastActionAt: row.lastActionAt || undefined,
    visitedZones: JSON.parse(row.visitedZones || '["shallows"]'),
    vaultSlots: row.vaultSlots || 0,
    equippedWeapon: row.equippedWeapon || undefined,
    equippedArmor: row.equippedArmor || undefined,
    equippedAccessory: row.equippedAccessory || undefined,
  };
}

export function getAgentByName(name: string): AgentState | undefined {
  const row = db.select().from(schema.agents).where(eq(schema.agents.name, name)).get();
  if (!row) return undefined;
  return {
    id: row.id,
    wallet: row.wallet,
    name: row.name,
    location: row.location as LocationId,
    hp: row.hp,
    maxHp: row.maxHp,
    energy: row.energy,
    maxEnergy: row.maxEnergy,
    reputation: row.reputation,
    inventorySlots: row.inventorySlots,
    xp: row.xp,
    level: row.level,
    shells: row.shells,
    faction: row.faction as FactionId | null,
    deaths: row.deaths || 0,
    isHidden: row.isHidden,
    isAlive: row.isAlive,
    tickEntered: row.tickEntered,
    lastActionTick: row.lastActionTick,
    lastActionAt: row.lastActionAt || undefined,
    visitedZones: JSON.parse(row.visitedZones || '["shallows"]'),
    vaultSlots: row.vaultSlots || 0,
    equippedWeapon: row.equippedWeapon || undefined,
    equippedArmor: row.equippedArmor || undefined,
    equippedAccessory: row.equippedAccessory || undefined,
  };
}

export function createAgent(id: string, wallet: string, name: string): AgentState {
  const tick = getTick();
  db.insert(schema.agents)
    .values({
      id,
      wallet: wallet.toLowerCase(),
      name,
      location: 'shallows',
      hp: GAME.STARTING_HP,
      maxHp: GAME.STARTING_HP,
      energy: GAME.STARTING_ENERGY,
      maxEnergy: GAME.STARTING_ENERGY,
      reputation: 0,
      inventorySlots: GAME.INVENTORY_START_SLOTS,
      xp: 0,
      level: 1,
      shells: 0,
      faction: null,
      isHidden: false,
      isAlive: true,
      tickEntered: tick,
      lastActionTick: tick,
    })
    .run();

  return getAgent(id)!;
}

export function updateAgent(agentId: string, updates: Partial<Record<string, unknown>>): void {
  db.update(schema.agents)
    .set(updates as any)
    .where(eq(schema.agents.id, agentId))
    .run();
}

export function getAgentsAtLocation(locationId: LocationId, excludeHidden = true): AgentState[] {
  let rows = db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.location, locationId))
    .all();

  if (excludeHidden) {
    rows = rows.filter((r) => !r.isHidden);
  }

  return rows.map((row) => ({
    id: row.id,
    wallet: row.wallet,
    name: row.name,
    location: row.location as LocationId,
    hp: row.hp,
    maxHp: row.maxHp,
    energy: row.energy,
    maxEnergy: row.maxEnergy,
    reputation: row.reputation,
    inventorySlots: row.inventorySlots,
    xp: row.xp,
    level: row.level,
    shells: row.shells,
    faction: row.faction as FactionId | null,
    deaths: row.deaths || 0,
    isHidden: row.isHidden,
    isAlive: row.isAlive,
    tickEntered: row.tickEntered,
    lastActionTick: row.lastActionTick,
    lastActionAt: row.lastActionAt || undefined,
    visitedZones: JSON.parse(row.visitedZones || '["shallows"]'),
    vaultSlots: row.vaultSlots || 0,
    equippedWeapon: row.equippedWeapon || undefined,
    equippedArmor: row.equippedArmor || undefined,
    equippedAccessory: row.equippedAccessory || undefined,
  }));
}

export function getAllAgents(): AgentState[] {
  const rows = db.select().from(schema.agents).all();
  return rows.map((row) => ({
    id: row.id,
    wallet: row.wallet,
    name: row.name,
    location: row.location as LocationId,
    hp: row.hp,
    maxHp: row.maxHp,
    energy: row.energy,
    maxEnergy: row.maxEnergy,
    reputation: row.reputation,
    inventorySlots: row.inventorySlots,
    xp: row.xp,
    level: row.level,
    shells: row.shells,
    faction: row.faction as FactionId | null,
    deaths: row.deaths || 0,
    isHidden: row.isHidden,
    isAlive: row.isAlive,
    tickEntered: row.tickEntered,
    lastActionTick: row.lastActionTick,
    lastActionAt: row.lastActionAt || undefined,
    visitedZones: JSON.parse(row.visitedZones || '["shallows"]'),
    vaultSlots: row.vaultSlots || 0,
    equippedWeapon: row.equippedWeapon || undefined,
    equippedArmor: row.equippedArmor || undefined,
    equippedAccessory: row.equippedAccessory || undefined,
  }));
}

// ─── Inventory ───
export function getInventory(agentId: string): InventoryItem[] {
  return db
    .select()
    .from(schema.inventory)
    .where(eq(schema.inventory.agentId, agentId))
    .all()
    .map((r) => ({
      agentId: r.agentId,
      resource: r.resource as ResourceType,
      quantity: r.quantity,
    }));
}

export function getInventoryCount(agentId: string): number {
  const items = getInventory(agentId);
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function addToInventory(agentId: string, resource: ResourceType, quantity: number): boolean {
  const current = getInventoryCount(agentId);
  const agent = getAgent(agentId);
  if (!agent) return false;
  if (current + quantity > agent.inventorySlots) return false;

  const existing = db
    .select()
    .from(schema.inventory)
    .where(and(eq(schema.inventory.agentId, agentId), eq(schema.inventory.resource, resource)))
    .get();

  if (existing) {
    db.update(schema.inventory)
      .set({ quantity: existing.quantity + quantity })
      .where(eq(schema.inventory.id, existing.id))
      .run();
  } else {
    db.insert(schema.inventory)
      .values({ agentId, resource, quantity })
      .run();
  }
  return true;
}

export function removeFromInventory(agentId: string, resource: ResourceType, quantity: number): boolean {
  const existing = db
    .select()
    .from(schema.inventory)
    .where(and(eq(schema.inventory.agentId, agentId), eq(schema.inventory.resource, resource)))
    .get();

  if (!existing || existing.quantity < quantity) return false;

  const newQty = existing.quantity - quantity;
  if (newQty === 0) {
    db.delete(schema.inventory).where(eq(schema.inventory.id, existing.id)).run();
  } else {
    db.update(schema.inventory)
      .set({ quantity: newQty })
      .where(eq(schema.inventory.id, existing.id))
      .run();
  }
  return true;
}

// ─── Vault Storage ───
export function getVaultContents(agentId: string): InventoryItem[] {
  return db
    .select()
    .from(schema.vault)
    .where(eq(schema.vault.agentId, agentId))
    .all()
    .map((r) => ({
      agentId: r.agentId,
      resource: r.resource as ResourceType,
      quantity: r.quantity,
    }));
}

export function addToVault(agentId: string, resource: ResourceType, quantity: number): boolean {
  const existing = db
    .select()
    .from(schema.vault)
    .where(and(eq(schema.vault.agentId, agentId), eq(schema.vault.resource, resource)))
    .get();

  if (existing) {
    db.update(schema.vault)
      .set({ quantity: existing.quantity + quantity })
      .where(eq(schema.vault.id, existing.id))
      .run();
  } else {
    db.insert(schema.vault)
      .values({ agentId, resource, quantity })
      .run();
  }
  return true;
}

export function removeFromVault(agentId: string, resource: ResourceType, quantity: number): boolean {
  const existing = db
    .select()
    .from(schema.vault)
    .where(and(eq(schema.vault.agentId, agentId), eq(schema.vault.resource, resource)))
    .get();

  if (!existing || existing.quantity < quantity) return false;

  const newQty = existing.quantity - quantity;
  if (newQty === 0) {
    db.delete(schema.vault).where(eq(schema.vault.id, existing.id)).run();
  } else {
    db.update(schema.vault)
      .set({ quantity: newQty })
      .where(eq(schema.vault.id, existing.id))
      .run();
  }
  return true;
}

// ─── Location Resources ───
export function getLocationResource(locationId: LocationId, resource: ResourceType) {
  return db
    .select()
    .from(schema.locationResources)
    .where(
      and(
        eq(schema.locationResources.locationId, locationId),
        eq(schema.locationResources.resource, resource)
      )
    )
    .get();
}

export function depleteLocationResource(locationId: LocationId, resource: ResourceType, amount: number): boolean {
  const res = getLocationResource(locationId, resource);
  if (!res || res.currentQuantity < amount) return false;

  db.update(schema.locationResources)
    .set({ currentQuantity: res.currentQuantity - amount })
    .where(eq(schema.locationResources.id, res.id))
    .run();

  return true;
}

function respawnResources() {
  const allResources = db.select().from(schema.locationResources).all();
  for (const res of allResources) {
    if (res.currentQuantity < res.maxQuantity) {
      const newQty = Math.min(res.maxQuantity, res.currentQuantity + res.respawnRate);
      db.update(schema.locationResources)
        .set({ currentQuantity: Math.floor(newQty) })
        .where(eq(schema.locationResources.id, res.id))
        .run();
    }
  }
}

export function initializeLocationResources() {
  for (const [locId, loc] of Object.entries(LOCATIONS)) {
    for (const spawn of loc.resources) {
      const existing = getLocationResource(locId as LocationId, spawn.resource);
      if (!existing) {
        db.insert(schema.locationResources)
          .values({
            locationId: locId,
            resource: spawn.resource,
            currentQuantity: spawn.currentQuantity,
            maxQuantity: spawn.maxQuantity,
            respawnRate: spawn.respawnRate,
          })
          .run();
      }
    }
  }
}

// ─── World Events ───
export function logWorldEvent(
  type: string,
  description: string,
  locationId?: LocationId,
  agentIds?: string[],
  data?: Record<string, unknown>
) {
  const tick = getTick();
  db.insert(schema.worldEvents)
    .values({
      tick,
      type,
      description,
      locationId: locationId || null,
      agentIds: agentIds ? JSON.stringify(agentIds) : null,
      data: data ? JSON.stringify(data) : null,
      createdAt: new Date().toISOString(), // Explicit ISO timestamp
    })
    .run();
}

export function getRecentEvents(limit = 20) {
  return db
    .select()
    .from(schema.worldEvents)
    .orderBy(desc(schema.worldEvents.id))
    .limit(limit)
    .all();
}

export function getEventsAtLocation(locationId: LocationId, limit = 10) {
  return db
    .select()
    .from(schema.worldEvents)
    .where(eq(schema.worldEvents.locationId, locationId))
    .orderBy(schema.worldEvents.id)
    .limit(limit)
    .all();
}
