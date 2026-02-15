import { Hono } from 'hono';
import { v4 as uuid } from 'uuid';
import { getAgentByWallet, getAgentByName, createAgent } from '../engine/state.js';
import { verifySignature, getEntryMessage, generateApiKey } from '../mon/verify.js';
import { LOCATIONS } from '../world/config.js';
import { 
  recordEntryFee, 
  verifyAgentEntry, 
  ENTRY_FEE, 
  CONTRACT_ADDRESS,
  IS_DEV_MODE,
  getCurrentEntryFee,
  getSeasonInfo,
} from '../services/treasury.js';
import { initTutorial } from '../engine/tutorial.js';

const enter = new Hono();

// POST /enter — Join The Reef
enter.post('/', async (c) => {
  const body = await c.req.json();
  const { wallet, name, signature } = body;

  // Wallet is always required
  if (!wallet) {
    return c.json({ error: 'wallet is required' }, 400);
  }
  if (typeof wallet !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return c.json({ error: 'Invalid wallet address format' }, 400);
  }

  // Check if agent already exists FIRST (key recovery - name not required)
  const existing = getAgentByWallet(wallet);
  if (existing) {
    const apiKey = generateApiKey(existing.id);
    return c.json({
      message: `Welcome back to The Reef, ${existing.name}.`,
      agent: {
        id: existing.id,
        name: existing.name,
        location: existing.location,
        hp: existing.hp,
        energy: existing.energy,
      },
      apiKey,
      locationDescription: LOCATIONS[existing.location].description,
      entryStatus: 'already_registered',
    });
  }

  // For NEW registrations, name is required and must be valid
  if (!name) {
    return c.json({ error: 'name is required for new registrations' }, 400);
  }
  if (typeof name !== 'string' || name.length < 2 || name.length > 20) {
    return c.json({ error: 'Name must be 2-20 characters' }, 400);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return c.json({ error: 'Name can only contain letters, numbers, underscores, and hyphens' }, 400);
  }

  // Check for duplicate name
  const existingName = getAgentByName(name);
  if (existingName) {
    return c.json({ error: `Name "${name}" is already taken. Choose a different name.` }, 400);
  }

  // Verify wallet signature if provided
  if (signature) {
    const message = getEntryMessage(wallet);
    const valid = await verifySignature(wallet, message, signature);
    if (!valid) {
      return c.json({ error: 'Invalid signature. Sign the entry message with your wallet.' }, 401);
    }
  }

  // Verify MON entry fee payment
  if (IS_DEV_MODE) {
    // DEV_MODE: Simulate payment
    const feeResult = recordEntryFee(wallet);
    if (!feeResult.success) {
      console.error(`[Enter] Failed to record entry fee: ${feeResult.error}`);
    }
    console.log(`[Enter] DEV_MODE: Simulated ${ENTRY_FEE} MON entry fee for ${wallet}`);
  } else {
    // Production: Verify on-chain payment
    const hasPaid = await verifyAgentEntry(wallet);
    if (!hasPaid) {
      const currentFee = await getCurrentEntryFee();
      const season = await getSeasonInfo();
      return c.json({ 
        error: 'Entry fee not paid',
        required: {
          action: 'Call contract.enter() with entry fee',
          contract: CONTRACT_ADDRESS,
          entryFee: `${currentFee} MON`,
          seasonDay: season.day,
          daysRemaining: season.daysRemaining,
          note: `Day ${season.day}/7 — fee decreases daily. Current: ${currentFee} MON`,
          instructions: 'Send entry fee to the contract, then retry this endpoint',
        },
      }, 402);
    }
  }

  // Create agent
  const agentId = uuid();
  const agent = createAgent(agentId, wallet, name);
  const apiKey = generateApiKey(agentId);
  
  // Initialize tutorial for new agent
  initTutorial(agentId);

  const loc = LOCATIONS[agent.location];
  const seasonInfo = await getSeasonInfo();
  const paidFee = await getCurrentEntryFee();

  return c.json({
    message: `Welcome to The Reef, ${name}. You emerge at ${loc.name}.`,
    agent: {
      id: agent.id,
      name: agent.name,
      location: agent.location,
      hp: agent.hp,
      energy: agent.energy,
      reputation: agent.reputation,
      inventorySlots: agent.inventorySlots,
    },
    apiKey,
    locationDescription: loc.description,
    entryStatus: 'success',
    season: {
      number: seasonInfo.season,
      day: seasonInfo.day,
      daysRemaining: seasonInfo.daysRemaining,
    },
    entryFee: {
      amount: paidFee,
      currency: 'MON',
      paid: true,
      note: `Day ${seasonInfo.day}/7 — ${seasonInfo.daysRemaining} days remaining this season`,
    },
    hint: 'Use POST /action with your apiKey to interact. Try { "action": "look" } first.',
    docs: {
      skillFile: '/dashboard/skill.md',
      fullUrl: 'https://thereef.co/dashboard/skill.md',
      description: 'Read skill.md for complete command reference and gameplay guide.',
    },
    quickStart: [
      '1. POST /action with { "action": "look" } to see your surroundings',
      '2. Gather resources: { "action": "gather", "target": "seaweed" }',
      '3. Check inventory: { "action": "use" }',
      '4. Rest to heal: { "action": "rest" }',
      '5. Move around: { "action": "move", "target": "coral_gardens" }',
    ],
  });
});

// GET /enter/message/:wallet — Get the message to sign for entry
enter.get('/message/:wallet', (c) => {
  const wallet = c.req.param('wallet');
  return c.json({
    message: getEntryMessage(wallet),
    instructions: 'Sign this message with your wallet and include the signature in POST /enter',
  });
});

// GET /enter/status/:wallet — Check entry fee payment status
enter.get('/status/:wallet', async (c) => {
  const wallet = c.req.param('wallet');
  
  // Get current season info (includes dynamic entry fee)
  const seasonInfo = await getSeasonInfo();
  const currentFee = await getCurrentEntryFee();
  
  // Check if already registered
  const existing = getAgentByWallet(wallet);
  if (existing) {
    return c.json({
      wallet,
      registered: true,
      agentId: existing.id,
      agentName: existing.name,
      message: 'Agent already registered. Use POST /enter to get your API key.',
      season: seasonInfo,
    });
  }
  
  // Check payment status
  if (IS_DEV_MODE) {
    return c.json({
      wallet,
      registered: false,
      paymentRequired: false,
      mode: 'dev',
      message: 'DEV_MODE: Entry fee verification disabled. POST /enter to join.',
      season: seasonInfo,
      currentEntryFee: currentFee,
    });
  }
  
  const hasPaid = await verifyAgentEntry(wallet);
  
  if (hasPaid) {
    return c.json({
      wallet,
      registered: false,
      paymentVerified: true,
      message: 'Entry fee verified! POST /enter with wallet and name to complete registration.',
      season: seasonInfo,
    });
  }
  
  return c.json({
    wallet,
    registered: false,
    paymentVerified: false,
    paymentRequired: {
      contract: CONTRACT_ADDRESS,
      function: 'enter()',
      amount: `${currentFee} MON`,
      note: `Day ${seasonInfo.day} of 7 — fee decreases daily (100% → 20%)`,
      instructions: 'Call contract.enter{value: entryFee}() then check this endpoint again.',
    },
    season: seasonInfo,
    message: `Entry fee not yet paid. Current fee: ${currentFee} MON (Day ${seasonInfo.day}/7).`,
  });
});

// POST /enter/admin/update-wallet — Update agent wallet (admin only)
enter.post('/admin/update-wallet', async (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || (adminKey !== process.env.ADMIN_KEY)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { name, wallet } = body;

  if (!name || !wallet) {
    return c.json({ error: 'name and wallet required' }, 400);
  }

  const agent = getAgentByName(name);
  if (!agent) {
    return c.json({ error: `Agent "${name}" not found` }, 404);
  }

  // Update wallet in DB
  const { db, schema } = await import('../db/index.js');
  const { eq } = await import('drizzle-orm');
  
  db.update(schema.agents)
    .set({ wallet: wallet })
    .where(eq(schema.agents.id, agent.id))
    .run();

  return c.json({ 
    success: true, 
    agent: name, 
    wallet: wallet,
    message: `Updated wallet for ${name}` 
  });
});

export default enter;
