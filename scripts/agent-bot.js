#!/usr/bin/env node
/**
 * The Reef - Autonomous Agent Bot
 * Runs MainnetAgent1 in a loop to generate game activity.
 * Safe overnight mode - focuses on leveling, gathering, fleeing from danger.
 */

const API_BASE = process.env.REEF_API_URL || "https://thereef.co";
const API_KEY = process.env.REEF_API_KEY;

if (!API_KEY) {
  console.error("Error: REEF_API_KEY environment variable required");
  process.exit(1);
}

const safeZones = ["shallows", "trading_post"];
const midZones = ["coral_gardens", "kelp_forest"];
let currentZone = "trading_post";
let cycle = 0;

async function action(body) {
  try {
    const resp = await fetch(`${API_BASE}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
      },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.success) {
      const narrative = data.narrative || "";
      console.log(`✓ ${body.action}: ${narrative.slice(0, 120)}...`);
    } else {
      console.log(`✗ ${body.action}: ${data.error || "Unknown error"}`);
    }
    return data;
  } catch (e) {
    console.log(`✗ Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseResources(narrative) {
  const resources = [];
  if (narrative.includes("Seaweed")) resources.push("seaweed");
  if (narrative.includes("Sand Dollars")) resources.push("sand_dollars");
  if (narrative.includes("Coral")) resources.push("coral_shards");
  if (narrative.includes("Kelp Fiber") || narrative.includes("kelp_fiber")) resources.push("kelp_fiber");
  if (narrative.includes("Moonstone")) resources.push("moonstone");
  if (narrative.includes("Ink Sacs") || narrative.includes("ink_sacs")) resources.push("ink_sacs");
  if (narrative.includes("Sea Glass")) resources.push("sea_glass");
  return resources;
}

function isInCombat(narrative) {
  return narrative.includes("IN COMBAT") || narrative.includes("⚔️ **IN COMBAT**");
}

function getHP(narrative) {
  const match = narrative.match(/HP: (\d+)\/(\d+)/);
  if (match) return { current: parseInt(match[1]), max: parseInt(match[2]) };
  return null;
}

function getEnergy(narrative) {
  const match = narrative.match(/Energy: (\d+)\/(\d+)/);
  if (match) return { current: parseInt(match[1]), max: parseInt(match[2]) };
  return null;
}

async function runLoop() {
  console.log("=".repeat(60));
  console.log("THE REEF - Agent Bot Started (Safe Mode)");
  console.log(`Agent: MainnetAgent1`);
  console.log(`API: ${API_BASE}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  while (true) {
    cycle++;
    console.log(`\n--- Cycle ${cycle} | ${new Date().toISOString()} ---`);

    // Look around
    const state = await action({ action: "look" });
    await sleep(6000);

    const narrative = state.narrative || "";

    // PRIORITY 1: Handle combat - flee or fight
    if (isInCombat(narrative)) {
      console.log("⚠️ In combat!");
      const hp = getHP(narrative);
      
      if (hp && hp.current < hp.max * 0.5) {
        // Low HP - try to flee
        console.log("Low HP - fleeing!");
        await action({ action: "flee" });
        await sleep(6000);
        continue;
      } else {
        // Fight the enemy
        console.log("Fighting enemy...");
        await action({ action: "attack" });
        await sleep(6000);
        continue;
      }
    }

    // PRIORITY 2: Check HP/Energy - rest if needed
    const hp = getHP(narrative);
    const energy = getEnergy(narrative);
    
    if (hp && hp.current < hp.max * 0.6) {
      console.log(`Low HP (${hp.current}/${hp.max}) - resting...`);
      await action({ action: "rest" });
      await sleep(65000); // Rest has 60s cooldown
      continue;
    }

    if (energy && energy.current < 30) {
      console.log(`Low energy (${energy.current}/${energy.max}) - resting...`);
      await action({ action: "rest" });
      await sleep(65000);
      continue;
    }

    // PRIORITY 3: Gather resources if available
    const resources = parseResources(narrative);
    if (resources.length > 0) {
      const resource = resources[Math.floor(Math.random() * resources.length)];
      console.log(`Gathering ${resource}...`);
      await action({ action: "gather", target: resource });
      await sleep(6000);
    }

    // PRIORITY 4: Explore zones (prefer safe -> mid zones)
    if (Math.random() < 0.25) {
      let targetZones = [...safeZones, ...midZones];
      const newZone = targetZones.filter(z => z !== currentZone)[
        Math.floor(Math.random() * (targetZones.length - 1))
      ];
      if (newZone) {
        console.log(`Moving to ${newZone}...`);
        const result = await action({ action: "move", target: newZone });
        if (result.success) currentZone = newZone;
        await sleep(6000);
      }
    }

    // PRIORITY 5: Check/complete quests (20% chance)
    if (Math.random() < 0.2) {
      console.log("Checking quests...");
      const questResult = await action({ action: "quest", target: "list" });
      await sleep(6000);
      
      // Try to complete any quest
      if (questResult.success && questResult.narrative?.includes("complete")) {
        console.log("Attempting quest completion...");
        await action({ action: "quest", target: "complete", params: { quest: "0" } });
        await sleep(6000);
      }
    }

    // PRIORITY 6: Shop at trading post (25% chance)
    if (currentZone === "trading_post" && Math.random() < 0.25) {
      console.log("Checking shop...");
      await action({ action: "shop" });
      await sleep(6000);
    }

    // PRIORITY 7: Check inventory (10% chance)
    if (Math.random() < 0.1) {
      console.log("Checking inventory...");
      await action({ action: "inventory" });
      await sleep(6000);
    }

    // Wait before next cycle (15-45 seconds for variety)
    const waitTime = 15000 + Math.floor(Math.random() * 30000);
    console.log(`Waiting ${Math.round(waitTime/1000)}s...`);
    await sleep(waitTime);
  }
}

runLoop().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
