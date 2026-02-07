// ─── World Configuration (Example) ───
// This is a placeholder showing the world structure.
// The actual config defines all zones, mobs, items, and game constants.

import type { LocationId } from '../types.js';

export interface Location {
  id: LocationId;
  name: string;
  description: string;
  connections: LocationId[];
  dangerLevel: number;
  resources: string[];
  hasShop?: boolean;
  hasFastTravel?: boolean;
}

export interface MobTemplate {
  id: string;
  name: string;
  hp: number;
  damage: number;
  xpReward: number;
  shellReward: [number, number];
  lootTable: Array<{ item: string; chance: number }>;
}

// Actual file contains:
// - LOCATIONS: 9 unique zones with connections
// - MOBS: Zone-specific enemy definitions
// - EQUIPMENT: Weapons, armor, accessories with stats
// - RESOURCES: Gatherable items per zone
// - CRAFTING_RECIPES: Item creation formulas
// - GAME constants: XP curves, damage formulas, etc.

export const LOCATIONS: Record<LocationId, Location> = {
  // Example zone
  shallows: {
    id: 'shallows',
    name: 'The Shallows',
    description: 'Warm, sunlit waters where beginners learn to survive.',
    connections: ['coral_gardens', 'trading_post'],
    dangerLevel: 1,
    resources: ['seaweed', 'shells'],
  },
  // ... 8 more zones
} as any;

export const GAME = {
  XP_PER_LEVEL: 100,
  MAX_LEVEL: 20,
  BASE_HP: 100,
  BASE_ENERGY: 50,
  // ... more constants
};
