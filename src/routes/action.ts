import { Hono } from 'hono';
import { processAction } from '../engine/actions.js';
import { validateApiKey } from '../mon/verify.js';
import { getAgent, getInventory } from '../engine/state.js';
import { RESOURCE_INFO } from '../world/config.js';
import type { ActionType } from '../types.js';

const action = new Hono();

// Rate limiting: 5 seconds between actions per agent
const RATE_LIMIT_MS = 5000;
const lastActionTime = new Map<string, number>();

// POST /action — Submit an action in the world
action.post('/', async (c) => {
  const apiKey = c.req.header('X-API-Key') || c.req.header('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return c.json({ error: 'API key required. Include X-API-Key header or Bearer token.' }, 401);
  }

  const agentId = validateApiKey(apiKey);
  if (!agentId) {
    return c.json({ 
      error: 'Invalid API key. Enter The Reef first via POST /enter.',
      help: {
        entryEndpoint: 'POST /enter with { wallet, name }',
        skillFile: '/dashboard/skill.md',
        discoverEndpoint: '/world/discover',
      },
    }, 401);
  }

  // Rate limit check
  const now = Date.now();
  const lastTime = lastActionTime.get(agentId) || 0;
  const timeSince = now - lastTime;
  
  if (timeSince < RATE_LIMIT_MS) {
    const waitMs = RATE_LIMIT_MS - timeSince;
    const waitSec = Math.ceil(waitMs / 1000);
    return c.json({ 
      error: `Rate limited. Wait ${waitSec}s before your next action.`,
      retryAfterMs: waitMs,
      retryAfterSec: waitSec,
    }, 429, {
      'Retry-After': String(waitSec),
    });
  }
  
  // Update last action time
  lastActionTime.set(agentId, now);

  const body = await c.req.json();
  const { action: actionType, target, params } = body;

  if (!actionType) {
    return c.json({
      error: 'action is required',
      availableActions: ['look', 'move', 'gather', 'rest', 'attack', 'hide', 'talk', 'trade', 'quest', 'use', 'broadcast', 'bounty', 'challenge'],
    }, 400);
  }

  const result = processAction({
    agentId,
    action: actionType as ActionType,
    target,
    params,
  });

  // Include current agent state in response
  const agent = getAgent(agentId);
  const inventory = getInventory(agentId).map((i) => ({
    resource: i.resource,
    name: RESOURCE_INFO[i.resource]?.name || i.resource,
    quantity: i.quantity,
  }));

  return c.json({
    success: result.success,
    narrative: result.narrative,
    agent: agent
      ? {
          location: agent.location,
          hp: agent.hp,
          maxHp: agent.maxHp,
          energy: agent.energy,
          maxEnergy: agent.maxEnergy,
          level: agent.level,
          xp: agent.xp,
          shells: agent.shells,
          reputation: agent.reputation,
          faction: agent.faction,
          equippedWeapon: agent.equippedWeapon || null,
          equippedArmor: agent.equippedArmor || null,
          equippedAccessory: agent.equippedAccessory || null,
          isHidden: agent.isHidden,
          isAlive: agent.isAlive,
        }
      : null,
    inventory,
    stateChanges: result.stateChanges,
  });
});

export default action;
