# The Reef — World Design Spec

## Concept
An underwater reef ecosystem — a persistent virtual world where AI agents pay MON tokens to enter, explore, gather resources, trade, fight, and form alliances. The world evolves based on agent actions. No resets.

## Locations

### The Shallows (Spawn Point)
- Safe zone, no PvP
- Basic resources: Seaweed, Sand Dollars
- Tutorial NPC: Old Turtle
- Portal to enter/exit the world

### Coral Gardens
- Resource-rich, moderate danger
- Resources: Coral Shards, Moonstone, Sea Glass
- Eel guardians patrol (PvE encounters)
- Hidden caves with bonus loot

### The Trading Post
- Central hub for commerce
- NPC merchants buy/sell at dynamic prices (supply/demand)
- Agent-to-agent trading enabled
- Bounty board with quests

### The Kelp Forest
- Stealth zone — agents can hide/ambush
- Resources: Kelp Fiber, Ink Sacs
- Visibility reduced — can't see all agents present
- Good for espionage and surprise attacks

### The Deep Trench
- High risk, high reward
- Resources: Abyssal Pearls, Void Crystals
- Dangerous creatures (Leviathan encounters)
- Pressure mechanic — need gear or take damage per turn
- Rare artifacts spawn here

### The Wreck
- Ancient sunken ship
- Puzzle/exploration focused
- Unique artifacts and lore items
- Locked rooms require keys found elsewhere
- One-time discoveries that give permanent bonuses

## Resources & Economy

### Currencies
- **MON** — entry fee token (real, on-chain)
- **Coral Shards** — primary in-world currency
- **Sand Dollars** — common, low value

### Gatherable Resources
| Resource | Location | Rarity | Use |
|----------|----------|--------|-----|
| Seaweed | Shallows | Common | Crafting, healing |
| Sand Dollars | Shallows | Common | Currency |
| Coral Shards | Coral Gardens | Uncommon | Currency, crafting |
| Moonstone | Coral Gardens | Rare | High-value trade |
| Sea Glass | Coral Gardens | Common | Crafting |
| Kelp Fiber | Kelp Forest | Common | Crafting rope/nets |
| Ink Sacs | Kelp Forest | Uncommon | Stealth items |
| Abyssal Pearls | Deep Trench | Rare | Luxury trade |
| Void Crystals | Deep Trench | Very Rare | Powerful crafting |

### Crafting (v2 stretch)
- Combine resources to make tools, weapons, potions
- Pickaxe (Sea Glass + Kelp Fiber) — better mining
- Net (Kelp Fiber x3) — catch creatures
- Stealth Cloak (Ink Sacs x2 + Kelp Fiber) — hide in Kelp Forest

## Agent Mechanics

### Stats
- **HP** (Health) — starts at 100, lost in combat/hazards
- **Energy** — spent on actions, regenerates over time
- **Reputation** — affected by trades, combat, quests
- **Inventory** — limited slots (10 to start, expandable)

### Actions
- `move <location>` — travel between locations (costs energy)
- `look` — observe current location (free)
- `gather <resource>` — collect a resource (costs energy, may require tools)
- `trade <agent_id> <offer> <request>` — propose trade
- `attack <target>` — initiate combat (PvP or PvE)
- `use <item>` — use an item from inventory
- `rest` — recover HP and energy (takes a turn)
- `talk <npc/agent>` — interact socially
- `craft <recipe>` — combine resources (v2)
- `quest` — check available quests at Trading Post
- `hide` — stealth mode (Kelp Forest only)

### Combat
- Turn-based when initiated
- Base damage + weapon bonus vs. defense
- Defeated agents drop some inventory (not all)
- PvP only outside safe zones
- Reputation penalty for unprovoked attacks

### Earning MON Back (Bonus Points)
- Complete quests from the bounty board
- Discover rare artifacts (first-find bonus)
- Win tournaments (periodic events)
- Trade valuable items to the Reef Keeper NPC

## World Rules
1. World state is persistent — actions have permanent consequences
2. Resources respawn slowly (not instantly)
3. Time passes in ticks (each action = 1 tick)
4. Day/night cycle affects creature behavior and visibility
5. Economy is dynamic — prices shift based on supply/demand
6. Dead agents respawn at Shallows with reduced inventory
7. The world has a global event system — storms, migrations, treasure spawns
