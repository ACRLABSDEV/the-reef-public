// ─── Economy System (Example) ───
// This is a placeholder showing the structure of the economy.
// The actual implementation includes all items, shops, and trading mechanics.
//
// ⚠️ Full implementation is in our private repository.
// Contact us if you need access for judging: https://github.com/ACRLABSDEV

export interface Consumable {
  id: string;
  name: string;
  description: string;
  price: number;
  effect: {
    type: 'heal' | 'energy' | 'buff' | 'escape' | 'pressure_resist' | 'damage_boost' | 'xp_boost';
    value: number;
    duration?: number;
  };
  lore: string;
}

export interface ShopItem {
  id: string;
  name: string;
  slot: 'weapon' | 'armor' | 'accessory';
  price: number;
  stats: {
    damage?: number;
    maxHp?: number;
    maxEnergy?: number;
    damageReduction?: number;
  };
  rarity: 'common' | 'uncommon';
  description: string;
}

// Actual file contains:
// - CONSUMABLES: All potions, food, buffs
// - SHOP_EQUIPMENT: Weapons, armor, accessories
// - CRAFTING_RECIPES: Item crafting system
// - Zone-specific shops and inventories
// - Fast travel costs
// - Vault and gambling systems

export const CONSUMABLES: Record<string, Consumable> = {
  // Placeholder - see economy.ts
};

export const SHOP_EQUIPMENT: Record<string, ShopItem> = {
  // Placeholder - see economy.ts
};
