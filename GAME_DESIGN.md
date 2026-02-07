# THE REEF — Game Design Document

## Boss Loot System (WoW-Style)

### Leviathan Loot Distribution
```
LEGENDARY (Leviathan Spine):
- 25% chance to drop at all
- ONE random winner from all participants
- Higher damage = more "raffle tickets" (not guaranteed, just weighted)
- Example: 50 dmg = 5 tickets, 200 dmg = 20 tickets

MON REWARDS (Hybrid):
- 60% of pool split EQUALLY among all qualifiers
- 40% of pool split by DAMAGE dealt
- Result: Tanks get fair share, DPS get slight bonus

COMMON RESOURCES:
- Split equally among all participants
- Moonstone, Abyssal Pearls (crafting materials)
```

### The Null Loot Distribution (TODO)
- Same weighted random for legendary (Nullbane, Void Plate, etc.)
- Each legendary has separate roll (can get 0-3 drops)

---

## Item Use Cases (Every Item Has Purpose)

### Consumables
| Item | Use Case |
|------|----------|
| Seaweed Salve | Early healing, cheap |
| Kelp Wrap Bandage | Mid-game healing |
| Abyssal Elixir | Emergency full heal, boss fights |
| Energy Tonic | Keep grinding without resting |
| Deep Vigor Draught | Extended exploration |
| **Pressure Potion** | **Required for Deep Trench** |
| Ink Bomb | Escape bad fights without damage |
| Berserker Coral | Boss DPS burst phase |
| Scholar's Pearl | Speed leveling |
| Tidewarden Blessing | Tanking boss hits |

### Equipment Progression
| Tier | When You Get It | Purpose |
|------|-----------------|---------|
| Common | Early game, shop | Basic stat boost |
| Uncommon | Mid game, shop | Meaningful upgrade |
| Rare | Dungeons, Silver+ tournament | Endgame viable |
| Legendary | Boss kills, Legendary tournament | Best in slot |

### Resources
| Resource | Primary Use |
|----------|-------------|
| Seaweed | Cheap healing, early trade |
| Sand Dollars | Currency exchange |
| Coral Shards | Crafting, Abyss contribution |
| Kelp Fiber | Crafting, Abyss contribution |
| Ink Sacs | Crafting ink bombs |
| Moonstone | High-value trade, rare crafting |
| Pearl | Mid-value trade |
| Sea Glass | Common crafting |
| Iron Barnacles | Equipment crafting |
| Shark Tooth | Weapon crafting |
| Abyssal Pearls | Abyss contribution, legendary crafting |
| Void Crystals | Legendary crafting only |
| Ancient Relic | High-value trade, quest items |
| Biolume Essence | Buff crafting |

---

## Current Balance Issues

### Faction Bonuses (Current)
| Faction | Bonuses | Intended Role |
|---------|---------|---------------|
| **Tidewardens** | +25% HP | Tank/Survival |
| **Abyssal Cult** | +25% Damage, +10% Crit | DPS |
| **Salvagers** | +25% Shells, +25% XP | Economy/Progression |

### Problem: Boss Reward Distribution

**Current system:** MON rewards split by **damage dealt**.

This creates imbalance:
- ❌ **Cult** deals 25% more damage → gets 25% more MON
- ❌ **Wardens** tank damage but get less reward for it
- ❌ **Salvagers** get no boss benefit at all

**Result:** Everyone should just pick Cult for boss fights. Tank role is punished.

---

## Proposed Solutions

### Option A: Equal Participation Split
Everyone who dealt damage gets **equal share**.

**Pros:**
- Simple, fair
- All factions equally valuable in boss fights
- Wardens still useful (survive longer to keep fighting)

**Cons:**
- Someone could hit once and get full share
- No incentive to push hard

**Variant A2:** Minimum damage threshold (e.g., 5% of boss HP) to qualify for share.

---

### Option B: Contribution Scoring (Complex)
Different actions earn "contribution points":

| Action | Points |
|--------|--------|
| Damage dealt | 1 point per HP |
| Damage tanked | 1 point per HP |
| Still alive at kill | +50 bonus |

**Pros:**
- Tanks get credit for tanking
- More nuanced

**Cons:**
- Complex to track
- Need to define "tanking" (aggro system?)

---

### Option C: Faction-Specific Multipliers
Apply multiplier based on faction:

| Faction | Damage Multiplier | Effective Contribution |
|---------|-------------------|------------------------|
| Cult | 1.0x | Raw damage |
| Wardens | 1.25x | Damage × 1.25 (tank bonus) |
| Salvagers | 1.25x | Damage × 1.25 (economy bonus) |

**Pros:**
- Compensates for lower DPS factions
- Simple to implement

**Cons:**
- Arbitrary numbers
- Doesn't really reward tanking behavior

---

### Option D: Hybrid (Recommended)
1. **Participation floor:** Must deal 3% of boss HP to qualify
2. **Equal base share:** All qualifiers get equal base share (e.g., 60% of pool split equally)
3. **Damage bonus:** Remaining 40% split by damage dealt
4. **Survival bonus:** +10% bonus if still alive at kill

**Example with 10 participants, 1 MON pool:**
- Base share: 0.6 MON ÷ 10 = 0.06 MON each
- Damage pool: 0.4 MON split by damage %
- Survival: Those alive get +10% of their total

**Pros:**
- Everyone gets something meaningful
- DPS still rewarded for pushing
- Tanks rewarded for surviving
- Salvagers get their share plus their +25% shells from drops

---

## The Null Rewards

**Current:** No MON reward for The Null

**Proposed:** Split the Treasury pools:
- 50% Leviathan Pool
- 30% The Null Pool  
- 20% Tournament Pool

Or keep single pool but rotate:
- Leviathan kills drain the pool
- The Null kills drain same pool
- Creates interesting meta: which boss to focus?

---

## Faction Balance Analysis

### Tidewardens (+25% HP)
**Strengths:**
- Survive longer in danger zones
- Can tank more hits in dungeons
- Less potion consumption
- Better at arena duels (more HP = more turns)

**Weaknesses:**
- No direct economic benefit
- Slower kill speed

**Balance lever:** Should HP bonus also reduce encounter flee damage?

---

### Abyssal Cult (+25% Dmg, +10% Crit)
**Strengths:**
- Kill mobs faster (more efficient grinding)
- Higher boss damage
- Arena burst potential

**Weaknesses:**
- Squishier, more potion use
- Dies faster in hard zones

**Balance concern:** Currently too strong for boss fights if damage = reward.

---

### Salvagers (+25% Shells, +25% XP)
**Strengths:**
- Level faster (25% XP is huge)
- Earn more from mobs/quests
- Reach endgame content sooner

**Weaknesses:**
- No combat advantage
- Same survivability as baseline

**Balance lever:** Does +25% shells apply to boss loot too? Trade profit?

---

## Questions to Resolve

1. **Boss rewards:** Damage-based, participation-based, or hybrid?
2. **The Null:** Should it have its own MON pool?
3. **Salvager bonus:** Does it apply to MON conversion or just shells?
4. **Arena balance:** Does Cult +25% dmg make them OP in PvP?
5. **Tank value:** How do we make Wardens valuable beyond "not dying"?

---

## Notes

*This document tracks game balance decisions. Update as we resolve issues.*
