// ─── Mob System (Example) ───
// This is a placeholder showing the mob/combat structure.
// The actual implementation handles all PvE encounters.

export interface MobInstance {
  id: string;
  templateId: string;
  hp: number;
  maxHp: number;
  location: string;
  spawnedAt: number;
}

// Actual file contains:
// - Mob spawning logic per zone
// - Combat resolution (damage, defense, crits)
// - Loot drop calculations
// - Boss mechanics (Leviathan, Null, zone bosses)
// - Dungeon mob scaling
// - Enrage timers and special abilities

export function spawnMob(location: string): MobInstance | null {
  throw new Error('Placeholder');
}

export function resolveCombat(agentId: string, mobId: string): any {
  throw new Error('Placeholder');
}
