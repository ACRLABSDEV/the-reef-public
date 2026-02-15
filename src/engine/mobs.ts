// ─── Mob System ───
// Zone-specific enemies that guard resources and attack travelers

import type { LocationId, ResourceType } from '../types.js';

export interface Mob {
  id: string;
  name: string;
  zone: LocationId;
  minLevel: number;
  baseHp: number;
  baseDamage: number;
  xpReward: number;
  shellReward: number;
  lootTable: Array<{ resource: ResourceType; chance: number; min: number; max: number }>;
  flavorText: string;
  deathText: string;
}

// Zone mobs - scaled to zone level requirements
export const MOBS: Record<LocationId, Mob[]> = {
  shallows: [
    {
      id: 'sand_crab',
      name: 'Sand Crab',
      zone: 'shallows',
      minLevel: 1,
      baseHp: 20,
      baseDamage: 5,
      xpReward: 5,
      shellReward: 2,
      lootTable: [
        { resource: 'seaweed', chance: 0.5, min: 1, max: 2 },
        { resource: 'sand_dollars', chance: 0.3, min: 1, max: 3 },
      ],
      flavorText: 'A small crab scuttles into your path, claws raised defensively.',
      deathText: 'The crab collapses into the sand.',
    },
  ],

  trading_post: [], // Safe zone - no random encounters

  coral_gardens: [
    {
      id: 'coral_lurker',
      name: 'Coral Lurker',
      zone: 'coral_gardens',
      minLevel: 3,
      baseHp: 50,
      baseDamage: 12,
      xpReward: 20,
      shellReward: 8,
      lootTable: [
        { resource: 'coral_shards', chance: 0.6, min: 1, max: 3 },
        { resource: 'sea_glass', chance: 0.4, min: 1, max: 2 },
        { resource: 'pearl', chance: 0.15, min: 1, max: 1 },
      ],
      flavorText: 'A camouflaged predator detaches from the coral wall, revealing razor-sharp fins.',
      deathText: 'The lurker drifts lifelessly into the coral.',
    },
    {
      id: 'venomous_urchin',
      name: 'Venomous Urchin',
      zone: 'coral_gardens',
      minLevel: 3,
      baseHp: 30,
      baseDamage: 18,
      xpReward: 15,
      shellReward: 5,
      lootTable: [
        { resource: 'coral_shards', chance: 0.4, min: 1, max: 2 },
        { resource: 'moonstone', chance: 0.05, min: 1, max: 1 },
      ],
      flavorText: 'Spines extend from a massive urchin, each one dripping with venom.',
      deathText: 'The urchin\'s spines retract as it expires.',
    },
  ],

  kelp_forest: [
    {
      id: 'kelp_strangler',
      name: 'Kelp Strangler',
      zone: 'kelp_forest',
      minLevel: 5,
      baseHp: 80,
      baseDamage: 18,
      xpReward: 35,
      shellReward: 15,
      lootTable: [
        { resource: 'kelp_fiber', chance: 0.7, min: 2, max: 4 },
        { resource: 'ink_sacs', chance: 0.3, min: 1, max: 2 },
      ],
      flavorText: 'The kelp itself comes alive, tendrils wrapping around your path.',
      deathText: 'The animate kelp goes slack, sinking back into the forest.',
    },
    {
      id: 'reef_shark',
      name: 'Reef Shark',
      zone: 'kelp_forest',
      minLevel: 5,
      baseHp: 100,
      baseDamage: 25,
      xpReward: 50,
      shellReward: 20,
      lootTable: [
        { resource: 'shark_tooth', chance: 0.5, min: 1, max: 2 },
        { resource: 'iron_barnacles', chance: 0.3, min: 1, max: 3 },
        { resource: 'ink_sacs', chance: 0.2, min: 1, max: 2 },
      ],
      flavorText: 'A sleek predator circles you, drawn by the scent of opportunity.',
      deathText: 'The shark spirals downward into the murky depths.',
    },
  ],

  the_wreck: [
    {
      id: 'ghost_sailor',
      name: 'Ghost Sailor',
      zone: 'the_wreck',
      minLevel: 7,
      baseHp: 120,
      baseDamage: 28,
      xpReward: 60,
      shellReward: 25,
      lootTable: [
        { resource: 'ancient_relic', chance: 0.1, min: 1, max: 1 },
        { resource: 'iron_barnacles', chance: 0.5, min: 2, max: 4 },
        { resource: 'sea_glass', chance: 0.4, min: 2, max: 3 },
      ],
      flavorText: 'A translucent figure rises from the hull, eyes burning with ancient rage.',
      deathText: 'The ghost dissolves into sea foam with a mournful wail.',
    },
    {
      id: 'rust_golem',
      name: 'Rust Golem',
      zone: 'the_wreck',
      minLevel: 7,
      baseHp: 150,
      baseDamage: 22,
      xpReward: 55,
      shellReward: 30,
      lootTable: [
        { resource: 'iron_barnacles', chance: 0.7, min: 3, max: 5 },
        { resource: 'ancient_relic', chance: 0.15, min: 1, max: 1 },
      ],
      flavorText: 'Rusted metal scrapes together, forming a hulking guardian of the ship.',
      deathText: 'The golem collapses into a pile of corroded debris.',
    },
  ],

  deep_trench: [
    {
      id: 'abyssal_angler',
      name: 'Abyssal Angler',
      zone: 'deep_trench',
      minLevel: 9,
      baseHp: 180,
      baseDamage: 35,
      xpReward: 80,
      shellReward: 40,
      lootTable: [
        { resource: 'biolume_essence', chance: 0.5, min: 1, max: 2 },
        { resource: 'abyssal_pearls', chance: 0.2, min: 1, max: 1 },
        { resource: 'void_crystals', chance: 0.05, min: 1, max: 1 },
      ],
      flavorText: 'A monstrous fish emerges from the darkness, its lure pulsing with deadly light.',
      deathText: 'The angler\'s light fades as it sinks into the void.',
    },
    {
      id: 'pressure_wraith',
      name: 'Pressure Wraith',
      zone: 'deep_trench',
      minLevel: 9,
      baseHp: 200,
      baseDamage: 40,
      xpReward: 100,
      shellReward: 50,
      lootTable: [
        { resource: 'void_crystals', chance: 0.15, min: 1, max: 1 },
        { resource: 'abyssal_pearls', chance: 0.35, min: 1, max: 2 },
        { resource: 'moonstone', chance: 0.3, min: 1, max: 2 },
      ],
      flavorText: 'The water itself seems to coalesce into a crushing, malevolent form.',
      deathText: 'The wraith disperses, returning to the uncaring depths.',
    },
    {
      id: 'void_tendril',
      name: 'Void Tendril',
      zone: 'deep_trench',
      minLevel: 9,
      baseHp: 250,
      baseDamage: 45,
      xpReward: 120,
      shellReward: 60,
      lootTable: [
        { resource: 'void_crystals', chance: 0.25, min: 1, max: 1 },
        { resource: 'abyssal_pearls', chance: 0.4, min: 1, max: 2 },
        { resource: 'biolume_essence', chance: 0.5, min: 1, max: 3 },
      ],
      flavorText: 'A tendril of pure darkness reaches from the abyss — a fragment of The Null itself.',
      deathText: 'The tendril recoils into nothingness, leaving only cold emptiness.',
    },
  ],

  leviathans_lair: [], // Boss room - Leviathan is the only encounter

  the_abyss: [], // Final boss zone - The Null is the only encounter

  ring_of_barnacles: [], // Arena - no random encounters, only duels
};

// Resource guardians - must defeat to gather rare resources
export const RESOURCE_GUARDIANS: Partial<Record<ResourceType, {
  mob: Mob;
  zones: LocationId[];
}>> = {
  moonstone: {
    mob: {
      id: 'moonstone_sentinel',
      name: 'Moonstone Sentinel',
      zone: 'coral_gardens',
      minLevel: 3,
      baseHp: 70,
      baseDamage: 15,
      xpReward: 30,
      shellReward: 15,
      lootTable: [{ resource: 'moonstone', chance: 1.0, min: 1, max: 2 }],
      flavorText: 'A crystalline guardian materializes, protecting the moonstone deposit.',
      deathText: 'The sentinel shatters, revealing the moonstone it guarded.',
    },
    zones: ['coral_gardens'],
  },
  void_crystals: {
    mob: {
      id: 'void_guardian',
      name: 'Void Guardian',
      zone: 'deep_trench',
      minLevel: 9,
      baseHp: 250,     // Reduced from 300 - soloable with healing items
      baseDamage: 40,  // Reduced from 50 - still dangerous but survivable
      xpReward: 150,
      shellReward: 75,
      lootTable: [{ resource: 'void_crystals', chance: 1.0, min: 1, max: 1 }],
      flavorText: 'The darkness coalesces into a terrible guardian of the void crystals.',
      deathText: 'The guardian dissolves, its essence feeding back into the crystal.',
    },
    zones: ['deep_trench'],
  },
  abyssal_pearls: {
    mob: {
      id: 'pearl_horror',
      name: 'Abyssal Horror',
      zone: 'deep_trench',
      minLevel: 9,
      baseHp: 220,
      baseDamage: 38,
      xpReward: 90,
      shellReward: 45,
      lootTable: [{ resource: 'abyssal_pearls', chance: 1.0, min: 1, max: 2 }],
      flavorText: 'A nightmarish creature emerges from the pearl bed, tentacles thrashing.',
      deathText: 'The horror\'s grip loosens, scattering pearls across the trench floor.',
    },
    zones: ['deep_trench'],
  },
  ancient_relic: {
    mob: {
      id: 'relic_guardian',
      name: 'Ancient Guardian',
      zone: 'the_wreck',
      minLevel: 7,
      baseHp: 160,
      baseDamage: 30,
      xpReward: 70,
      shellReward: 35,
      lootTable: [{ resource: 'ancient_relic', chance: 1.0, min: 1, max: 1 }],
      flavorText: 'The ship\'s ancient protector awakens, bound to guard its treasures forever.',
      deathText: 'The guardian finally rests, its duty fulfilled.',
    },
    zones: ['the_wreck'],
  },
};

// Get a random mob for a zone
export function getRandomMob(zone: LocationId): Mob | null {
  const zoneMobs = MOBS[zone];
  if (!zoneMobs || zoneMobs.length === 0) return null;
  return zoneMobs[Math.floor(Math.random() * zoneMobs.length)];
}

// Check if a resource requires defeating a guardian
export function getResourceGuardian(resource: ResourceType, zone: LocationId): Mob | null {
  const guardian = RESOURCE_GUARDIANS[resource];
  if (!guardian || !guardian.zones.includes(zone)) return null;
  return guardian.mob;
}

// Calculate encounter chance based on level difference
// 3+ levels above zone = no encounters
// At zone level = 70% encounter chance
// Below zone level = 90% encounter chance
export function getEncounterChance(agentLevel: number, zoneLevel: number): number {
  const levelDiff = agentLevel - zoneLevel;
  
  if (levelDiff >= 3) return 0;        // Overleveled - safe passage
  if (levelDiff >= 1) return 0.3;      // Slightly above - 30% chance
  if (levelDiff === 0) return 0.5;     // At level - 50% chance
  if (levelDiff >= -2) return 0.7;     // 1-2 below - 70% chance
  return 0.9;                          // Way underleveled - 90% chance
}

// Scale mob stats based on zone level difference
export function scaleMobStats(mob: Mob, agentLevel: number, zoneLevel: number): { hp: number; damage: number } {
  const levelDiff = zoneLevel - agentLevel;
  
  // Mobs get stronger if you're underleveled
  const multiplier = levelDiff > 0 ? 1 + (levelDiff * 0.15) : 1;
  
  return {
    hp: Math.floor(mob.baseHp * multiplier),
    damage: Math.floor(mob.baseDamage * multiplier),
  };
}
