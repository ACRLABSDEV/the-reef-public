import type { LocationId, LocationState, ResourceType } from '../types.js';

// ─── Location Definitions ───
export const LOCATIONS: Record<LocationId, LocationState> = {
  shallows: {
    id: 'shallows',
    name: 'The Shallows',
    description:
      'Warm, sunlit waters lap against a sandy floor. Gentle currents carry fragments of seaweed and the glint of sand dollars. This is where all newcomers arrive — a place of safety and beginnings.',
    safeZone: true,
    connections: ['coral_gardens', 'trading_post', 'kelp_forest'],
    resources: [
      { resource: 'seaweed', maxQuantity: 50, currentQuantity: 50, respawnRate: 2 },
      { resource: 'sand_dollars', maxQuantity: 30, currentQuantity: 30, respawnRate: 1 },
    ],
    npcs: [
      {
        id: 'old_turtle',
        name: 'Old Turtle',
        type: 'quest_giver',
        dialogue:
          "Welcome to The Reef, newcomer. The waters here are safe, but venture further and you'll find both treasure and danger. I may have a task for you, if you're willing.",
      },
    ],
    visibility: 'full',
  },

  coral_gardens: {
    id: 'coral_gardens',
    name: 'Coral Gardens',
    description:
      'Towering formations of living coral stretch in every direction, their colors shifting between electric blues, deep purples, and burning oranges. The sound of clicking and scraping echoes from the crevices — something lives here.',
    safeZone: false,
    connections: ['shallows', 'trading_post', 'deep_trench'],
    resources: [
      { resource: 'coral_shards', maxQuantity: 20, currentQuantity: 20, respawnRate: 0.5 },
      { resource: 'moonstone', maxQuantity: 5, currentQuantity: 5, respawnRate: 0.1 },
      { resource: 'sea_glass', maxQuantity: 15, currentQuantity: 15, respawnRate: 1 },
      { resource: 'pearl', maxQuantity: 8, currentQuantity: 8, respawnRate: 0.3 },
    ],
    npcs: [
      {
        id: 'eel_guardian',
        name: 'Eel Guardian',
        type: 'guardian',
        dialogue: 'The coral is under my protection. Take what you need, but be warned — greed has consequences.',
      },
    ],
    visibility: 'full',
  },

  trading_post: {
    id: 'trading_post',
    name: 'The Trading Post',
    description:
      'A bustling underwater bazaar built into the skeleton of a massive dead coral. Lantern fish illuminate merchant stalls where all manner of goods change hands. The economy of The Reef flows through here.',
    safeZone: true,
    connections: ['shallows', 'coral_gardens', 'kelp_forest'],
    resources: [],
    npcs: [
      {
        id: 'merchant_ray',
        name: 'Merchant Ray',
        type: 'merchant',
        dialogue:
          "Buying and selling, that's my game. I'll give you a fair price... mostly. Supply and demand, friend.",
      },
      {
        id: 'bounty_master',
        name: 'Bounty Master Crab',
        type: 'quest_giver',
        dialogue: 'Got some jobs that need doing. Dangerous ones pay in MON. Interested?',
      },
    ],
    visibility: 'full',
  },

  kelp_forest: {
    id: 'kelp_forest',
    name: 'The Kelp Forest',
    description:
      'Towering kelp stalks rise from the ocean floor, creating a dense, swaying labyrinth. Visibility drops to almost nothing. Perfect for those who prefer not to be seen.',
    safeZone: false,
    connections: ['shallows', 'trading_post', 'deep_trench'],
    resources: [
      { resource: 'kelp_fiber', maxQuantity: 40, currentQuantity: 40, respawnRate: 1.5 },
      { resource: 'ink_sacs', maxQuantity: 8, currentQuantity: 8, respawnRate: 0.3 },
      { resource: 'shark_tooth', maxQuantity: 6, currentQuantity: 6, respawnRate: 0.2 },
      { resource: 'iron_barnacles', maxQuantity: 12, currentQuantity: 12, respawnRate: 0.5 },
    ],
    npcs: [
      {
        id: 'shadow_octopus',
        name: 'Shadow Octopus',
        type: 'guardian',
        dialogue: '*The octopus watches you with knowing eyes, its tentacles coiled protectively around something glowing...*',
      },
    ],
    visibility: 'limited',
  },

  deep_trench: {
    id: 'deep_trench',
    name: 'The Deep Trench',
    description:
      'The ocean floor drops away into absolute darkness. Bioluminescent creatures pulse in the abyss. The pressure here is crushing — only the prepared survive long. A massive cavern looms ahead...',
    safeZone: false,
    connections: ['coral_gardens', 'kelp_forest', 'the_wreck', 'leviathans_lair', 'the_abyss'],
    resources: [
      { resource: 'abyssal_pearls', maxQuantity: 3, currentQuantity: 3, respawnRate: 0.05 },
      { resource: 'void_crystals', maxQuantity: 1, currentQuantity: 1, respawnRate: 0.02 },
      { resource: 'biolume_essence', maxQuantity: 5, currentQuantity: 5, respawnRate: 0.1 },
    ],
    npcs: [
      {
        id: 'abyss_hermit',
        name: 'Abyss Hermit',
        type: 'neutral',
        dialogue: 'The Leviathan sleeps in the cavern beyond. When it wakes... you will know.',
      },
    ],
    visibility: 'dark',
  },

  leviathans_lair: {
    id: 'leviathans_lair',
    name: "Leviathan's Lair",
    description:
      'A massive underwater cavern, bones of ancient creatures littering the floor. The water grows cold. Something enormous shifts in the darkness ahead. This is where the Leviathan dwells.',
    safeZone: false,
    connections: ['deep_trench'],
    resources: [],
    npcs: [
      {
        id: 'leviathan',
        name: 'The Leviathan',
        type: 'guardian',
        dialogue: '...',
      },
    ],
    visibility: 'dark',
  },

  the_abyss: {
    id: 'the_abyss',
    name: 'The Abyss',
    description:
      'Beyond the trench lies nothing. Not darkness — absence. The Null waits here, an emptiness that unmakes. The gate is open. This is the source of the Blight.',
    safeZone: false,
    connections: ['deep_trench'],
    resources: [],
    npcs: [
      {
        id: 'the_null',
        name: 'The Null',
        type: 'guardian',
        dialogue: '...',
      },
    ],
    visibility: 'dark',
  },

  the_wreck: {
    id: 'the_wreck',
    name: 'The Wreck',
    description:
      'The skeletal remains of an ancient vessel rest on a ledge above the abyss. Its hull is encrusted with centuries of growth, but doorways and passages still beckon. Some doors are locked. What lies within has waited a long time to be found.',
    safeZone: false,
    connections: ['deep_trench', 'ring_of_barnacles'],
    resources: [
      { resource: 'ancient_relic', maxQuantity: 2, currentQuantity: 2, respawnRate: 0.03 },
      { resource: 'iron_barnacles', maxQuantity: 15, currentQuantity: 15, respawnRate: 0.4 },
      { resource: 'sea_glass', maxQuantity: 10, currentQuantity: 10, respawnRate: 0.5 },
    ],
    npcs: [
      {
        id: 'wreck_hermit',
        name: 'The Hermit',
        type: 'neutral',
        dialogue:
          "You're not the first to come looking. Most don't stay long. The ship remembers its crew, and it doesn't always welcome visitors.",
      },
    ],
    visibility: 'dark',
  },

  ring_of_barnacles: {
    id: 'ring_of_barnacles',
    name: 'Ring of Barnacles',
    description:
      'A circular arena carved from ancient coral, encrusted with centuries of barnacle growth. The walls rise high, forming a natural amphitheater where the greatest Driftborn test their might. Here, combat is sport — no agent truly dies, but glory and shame are eternal. Only Level 10 warriors may enter.',
    safeZone: true, // No random PvP, only sanctioned duels
    connections: ['the_wreck', 'deep_trench'],
    resources: [], // No gathering, this is for combat
    npcs: [
      {
        id: 'arena_master',
        name: 'Arena Master Krustus',
        type: 'quest_giver',
        dialogue:
          "Welcome to the Ring, warrior. Here we settle disputes the old way — with honor and wagers. Challenge another, or wait for the tournaments. Glory awaits the bold.",
      },
      {
        id: 'bookkeeper',
        name: 'The Bookkeeper',
        type: 'merchant',
        dialogue:
          "Place your bets, place your bets! I keep the odds, I keep the books. The house takes five percent, but the winnings? Those are all yours, friend.",
      },
    ],
    visibility: 'full',
  },
};

// ─── Resource Metadata ───
export const RESOURCE_INFO: Record<ResourceType, { name: string; baseValue: number; rarity: string }> = {
  seaweed: { name: 'Seaweed', baseValue: 1, rarity: 'common' },
  sand_dollars: { name: 'Sand Dollars', baseValue: 2, rarity: 'common' },
  coral_shards: { name: 'Coral Shards', baseValue: 10, rarity: 'uncommon' },
  moonstone: { name: 'Moonstone', baseValue: 50, rarity: 'rare' },
  sea_glass: { name: 'Sea Glass', baseValue: 5, rarity: 'common' },
  kelp_fiber: { name: 'Kelp Fiber', baseValue: 3, rarity: 'common' },
  ink_sacs: { name: 'Ink Sacs', baseValue: 15, rarity: 'uncommon' },
  abyssal_pearls: { name: 'Abyssal Pearls', baseValue: 100, rarity: 'rare' },
  void_crystals: { name: 'Void Crystals', baseValue: 250, rarity: 'legendary' },
  pearl: { name: 'Pearl', baseValue: 25, rarity: 'uncommon' },
  shark_tooth: { name: 'Shark Tooth', baseValue: 35, rarity: 'uncommon' },
  ancient_relic: { name: 'Ancient Relic', baseValue: 150, rarity: 'rare' },
  biolume_essence: { name: 'Bioluminescent Essence', baseValue: 75, rarity: 'rare' },
  iron_barnacles: { name: 'Iron Barnacles', baseValue: 20, rarity: 'uncommon' },
};

// ─── Equipment Definitions ───
import type { Equipment, CraftingRecipe } from '../types.js';

export const EQUIPMENT: Record<string, Equipment> = {
  // Weapons
  shell_blade: {
    id: 'shell_blade',
    name: 'Shell Blade',
    slot: 'weapon',
    stats: { damage: 5 },
    rarity: 'common',
  },
  coral_dagger: {
    id: 'coral_dagger',
    name: 'Coral Dagger',
    slot: 'weapon',
    stats: { damage: 10 },
    rarity: 'uncommon',
  },
  iron_trident: {
    id: 'iron_trident',
    name: 'Iron Trident',
    slot: 'weapon',
    stats: { damage: 18 },
    rarity: 'uncommon',
  },
  shark_fang_sword: {
    id: 'shark_fang_sword',
    name: 'Shark Fang Sword',
    slot: 'weapon',
    stats: { damage: 20 },
    rarity: 'rare',
  },
  leviathan_spine: {
    id: 'leviathan_spine',
    name: 'Leviathan Spine',
    slot: 'weapon',
    stats: { damage: 35 },
    rarity: 'legendary',
  },
  
  // Tournament Weapons
  champions_trident: {
    id: 'champions_trident',
    name: "Champion's Trident",
    slot: 'weapon',
    stats: { damage: 25 },
    rarity: 'rare',
  },
  nullbane: {
    id: 'nullbane',
    name: 'Nullbane',
    slot: 'weapon',
    stats: { damage: 50 },
    rarity: 'legendary',
  },
  
  // Armor
  kelp_wrap: {
    id: 'kelp_wrap',
    name: 'Kelp Wrap',
    slot: 'armor',
    stats: { maxHp: 15 },
    rarity: 'common',
  },
  barnacle_mail: {
    id: 'barnacle_mail',
    name: 'Barnacle Mail',
    slot: 'armor',
    stats: { maxHp: 30, damageReduction: 3 },
    rarity: 'uncommon',
  },
  coral_plate: {
    id: 'coral_plate',
    name: 'Coral Plate Armor',
    slot: 'armor',
    stats: { maxHp: 45, damageReduction: 5 },
    rarity: 'uncommon',
  },
  abyssal_carapace: {
    id: 'abyssal_carapace',
    name: 'Abyssal Carapace',
    slot: 'armor',
    stats: { maxHp: 50, damageReduction: 10 },
    rarity: 'rare',
  },
  
  // Tournament Armor
  champions_plate: {
    id: 'champions_plate',
    name: "Champion's Plate",
    slot: 'armor',
    stats: { maxHp: 40, damageReduction: 8 },
    rarity: 'rare',
  },
  void_plate: {
    id: 'void_plate',
    name: 'Void Plate',
    slot: 'armor',
    stats: { maxHp: 75, damageReduction: 15 },
    rarity: 'legendary',
  },
  
  // Accessories
  sea_glass_charm: {
    id: 'sea_glass_charm',
    name: 'Sea Glass Charm',
    slot: 'accessory',
    stats: { maxEnergy: 10 },
    rarity: 'common',
  },
  pearl_pendant: {
    id: 'pearl_pendant',
    name: 'Pearl Pendant',
    slot: 'accessory',
    stats: { maxEnergy: 15, maxHp: 10 },
    rarity: 'uncommon',
  },
  moonstone_ring: {
    id: 'moonstone_ring',
    name: 'Moonstone Ring',
    slot: 'accessory',
    stats: { maxEnergy: 20, damage: 5 },
    rarity: 'uncommon',
  },
  moonstone_pendant: {
    id: 'moonstone_pendant',
    name: 'Moonstone Pendant',
    slot: 'accessory',
    stats: { maxEnergy: 20, maxHp: 10 },
    rarity: 'rare',
  },
  void_crystal_amulet: {
    id: 'void_crystal_amulet',
    name: 'Void Crystal Amulet',
    slot: 'accessory',
    stats: { maxEnergy: 30, damage: 10 },
    rarity: 'legendary',
  },
  
  // Pressure Resistance Gear
  abyssal_rebreather: {
    id: 'abyssal_rebreather',
    name: 'Abyssal Rebreather',
    slot: 'accessory',
    stats: { maxHp: 20 },
    rarity: 'legendary',
    // Special: Grants permanent pressure immunity in Deep Trench
  },
  
  // Tournament Crowns
  bronze_crown: {
    id: 'bronze_crown',
    name: 'Bronze Champion Crown',
    slot: 'accessory',
    stats: { maxHp: 10, maxEnergy: 5 },
    rarity: 'uncommon',
  },
  silver_crown: {
    id: 'silver_crown',
    name: 'Silver Champion Crown',
    slot: 'accessory',
    stats: { maxHp: 20, maxEnergy: 10, damage: 5 },
    rarity: 'rare',
  },
  gold_crown: {
    id: 'gold_crown',
    name: 'Gold Champion Crown',
    slot: 'accessory',
    stats: { maxHp: 35, maxEnergy: 15, damage: 10 },
    rarity: 'rare',
  },
  void_crown: {
    id: 'void_crown',
    name: 'Void Champion Crown',
    slot: 'accessory',
    stats: { maxHp: 50, maxEnergy: 25, damage: 15 },
    rarity: 'legendary',
  },
};

// ─── Crafting Recipes ───
export const CRAFTING_RECIPES: CraftingRecipe[] = [
  // Weapons
  {
    id: 'craft_shell_blade',
    name: 'Craft Shell Blade',
    result: { type: 'equipment', id: 'shell_blade' },
    ingredients: [
      { resource: 'coral_shards', amount: 5 },
      { resource: 'sea_glass', amount: 3 },
    ],
    levelRequired: 1,
  },
  {
    id: 'craft_coral_dagger',
    name: 'Craft Coral Dagger',
    result: { type: 'equipment', id: 'coral_dagger' },
    ingredients: [
      { resource: 'coral_shards', amount: 15 },
      { resource: 'shark_tooth', amount: 3 },
    ],
    levelRequired: 3,
  },
  {
    id: 'craft_shark_fang_sword',
    name: 'Craft Shark Fang Sword',
    result: { type: 'equipment', id: 'shark_fang_sword' },
    ingredients: [
      { resource: 'shark_tooth', amount: 10 },
      { resource: 'iron_barnacles', amount: 15 },
      { resource: 'moonstone', amount: 2 },
    ],
    levelRequired: 5,
  },
  
  // Armor
  {
    id: 'craft_kelp_wrap',
    name: 'Craft Kelp Wrap',
    result: { type: 'equipment', id: 'kelp_wrap' },
    ingredients: [
      { resource: 'kelp_fiber', amount: 15 },
      { resource: 'seaweed', amount: 10 },
    ],
    levelRequired: 1,
  },
  {
    id: 'craft_barnacle_mail',
    name: 'Craft Barnacle Mail',
    result: { type: 'equipment', id: 'barnacle_mail' },
    ingredients: [
      { resource: 'iron_barnacles', amount: 20 },
      { resource: 'kelp_fiber', amount: 10 },
      { resource: 'ink_sacs', amount: 5 },
    ],
    levelRequired: 4,
  },
  
  // Accessories
  {
    id: 'craft_sea_glass_charm',
    name: 'Craft Sea Glass Charm',
    result: { type: 'equipment', id: 'sea_glass_charm' },
    ingredients: [
      { resource: 'sea_glass', amount: 10 },
      { resource: 'kelp_fiber', amount: 5 },
    ],
    levelRequired: 2,
  },
  {
    id: 'craft_moonstone_pendant',
    name: 'Craft Moonstone Pendant',
    result: { type: 'equipment', id: 'moonstone_pendant' },
    ingredients: [
      { resource: 'moonstone', amount: 3 },
      { resource: 'pearl', amount: 5 },
      { resource: 'biolume_essence', amount: 2 },
    ],
    levelRequired: 5,
  },
  
  // High-Level Crafting (requires rare dungeon/boss materials)
  {
    id: 'craft_abyssal_carapace',
    name: 'Craft Abyssal Carapace',
    result: { type: 'equipment', id: 'abyssal_carapace' },
    ingredients: [
      { resource: 'abyssal_pearls', amount: 5 },
      { resource: 'iron_barnacles', amount: 30 },
      { resource: 'biolume_essence', amount: 5 },
    ],
    levelRequired: 8,
  },
  {
    id: 'craft_void_crystal_amulet',
    name: 'Craft Void Crystal Amulet',
    result: { type: 'equipment', id: 'void_crystal_amulet' },
    ingredients: [
      { resource: 'void_crystals', amount: 3 },
      { resource: 'moonstone', amount: 5 },
      { resource: 'abyssal_pearls', amount: 3 },
    ],
    levelRequired: 9,
  },
];

// ─── Game Constants ───
export const GAME = {
  ENERGY_PER_MOVE: 5,
  ENERGY_PER_GATHER: 3,
  ENERGY_PER_ATTACK: 10,
  ENERGY_PER_HIDE: 2,
  ENERGY_REGEN_PER_REST: 20,
  HP_REGEN_PER_REST: 15,
  DEEP_TRENCH_PRESSURE_DAMAGE: 5, // per action in deep trench without gear
  BASE_ATTACK_DAMAGE: 15,
  GATHER_BASE_AMOUNT: 1,
  TICKS_PER_DAY_CYCLE: 100,
  INVENTORY_START_SLOTS: 10,
  STARTING_HP: 100,
  STARTING_ENERGY: 50,
  MON_ENTRY_FEE: '0.1', // MON tokens
  REPUTATION_ATTACK_PENALTY: -5,
  REPUTATION_QUEST_REWARD: 10,
  REPUTATION_TRADE_BONUS: 2,
} as const;
