// ─── Core Types ───

export type LocationId =
  | 'shallows'
  | 'coral_gardens'
  | 'trading_post'
  | 'kelp_forest'
  | 'deep_trench'
  | 'leviathans_lair'
  | 'the_abyss'
  | 'the_wreck'
  | 'ring_of_barnacles';

export type ResourceType =
  | 'seaweed'
  | 'sand_dollars'
  | 'coral_shards'
  | 'moonstone'
  | 'sea_glass'
  | 'kelp_fiber'
  | 'ink_sacs'
  | 'abyssal_pearls'
  | 'void_crystals'
  | 'pearl'
  | 'shark_tooth'
  | 'ancient_relic'
  | 'biolume_essence'
  | 'iron_barnacles';

// ─── Equipment Types ───
export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';

export interface Equipment {
  id: string;
  name: string;
  slot: EquipmentSlot;
  stats: {
    damage?: number;
    maxHp?: number;
    maxEnergy?: number;
    damageReduction?: number;
  };
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

export interface CraftingRecipe {
  id: string;
  name: string;
  result: { type: 'equipment' | 'resource'; id: string; amount?: number };
  ingredients: { resource: ResourceType; amount: number }[];
  levelRequired: number;
}

export type FactionId = 'wardens' | 'cult' | 'salvagers';

export type ActionType =
  | 'move'
  | 'look'
  | 'status'
  | 'gather'
  | 'trade'
  | 'attack'
  | 'use'
  | 'inventory'
  | 'inv'
  | 'rest'
  | 'talk'
  | 'hide'
  | 'quest'
  | 'broadcast'
  | 'whisper'
  | 'dm'
  | 'message'
  | 'inbox'
  | 'bounty'
  | 'challenge'
  | 'faction'
  | 'party'
  | 'dungeon'
  | 'abyss'
  | 'arena'
  | 'drop'
  | 'flee'
  | 'shop'
  | 'buy'
  | 'sell'
  | 'craft'
  | 'travel'
  | 'vault'
  | 'bet'
  | 'market'
  | 'pursue';

export interface AgentState {
  id: string;
  wallet: string;
  name: string;
  location: LocationId;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  reputation: number;
  inventorySlots: number;
  xp: number;
  level: number;
  shells: number;
  faction: FactionId | null;
  deaths: number;
  equippedWeapon?: string;
  equippedArmor?: string;
  equippedAccessory?: string;
  isHidden: boolean;
  isAlive: boolean;
  tickEntered: number;
  lastActionTick: number;
  lastActionAt?: number; // Unix timestamp (ms)
  // PvP flagging (set when gathering rare resources)
  pvpFlaggedUntil?: number; // tick when flag expires (null = not flagged)
  // Economy additions
  visitedZones: LocationId[];
  vaultSlots: number;
}

// Active buffs on an agent (tracked in-memory)
export interface ActiveBuff {
  type: 'pressure_resist' | 'damage_boost' | 'xp_boost' | 'hp_boost';
  value: number;
  expiresAt: number; // tick
}

export interface InventoryItem {
  agentId: string;
  resource: ResourceType;
  quantity: number;
}

export interface ActionRequest {
  agentId: string;
  action: ActionType;
  target?: string;
  params?: Record<string, string>;
}

export interface ActionResult {
  success: boolean;
  narrative: string;
  stateChanges: StateChange[];
  worldEvents: WorldEvent[];
}

export interface StateChange {
  type: 'agent' | 'resource' | 'location' | 'world';
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface WorldEvent {
  tick: number;
  type: string;
  description: string;
  locationId?: LocationId;
  agentIds?: string[];
}

export interface LocationState {
  id: LocationId;
  name: string;
  description: string;
  safeZone: boolean;
  connections: LocationId[];
  resources: ResourceSpawn[];
  npcs: NPC[];
  visibility: 'full' | 'limited' | 'dark';
}

export interface ResourceSpawn {
  resource: ResourceType;
  maxQuantity: number;
  currentQuantity: number;
  respawnRate: number; // quantity per tick
  requiresTool?: string;
}

export interface NPC {
  id: string;
  name: string;
  type: 'merchant' | 'quest_giver' | 'guardian' | 'neutral';
  dialogue: string;
}

export interface TradeOffer {
  id: string;
  fromAgent: string;
  toAgent: string;
  offering: { resource: ResourceType; quantity: number }[];
  requesting: { resource: ResourceType; quantity: number }[];
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdTick: number;
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  objective: string;
  reward: { resource: ResourceType; quantity: number }[];
  monReward?: number;
  difficulty: 'easy' | 'medium' | 'hard';
  claimedBy?: string;
  completed: boolean;
}
