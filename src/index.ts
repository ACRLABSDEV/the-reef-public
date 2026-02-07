import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { initializeDatabase } from './db/index.js';
import { initializeLocationResources } from './engine/state.js';
import enterRoutes from './routes/enter.js';
import actionRoutes from './routes/action.js';
import worldRoutes from './routes/world.js';
import eventRoutes from './routes/events.js';
import leaderboardRoutes from './routes/leaderboard.js';
import { initializeLeviathan, loadPersistedState, persistAllState } from './engine/actions.js';
import { loadApiKeysFromDb } from './mon/verify.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Initialize ───
console.log('🐚 Initializing The Reef...');
initializeDatabase();
loadApiKeysFromDb(); // Load persisted API keys
initializeLocationResources();
initializeLeviathan();
loadPersistedState(); // Load parties, dungeons, PvP, boss state from DB
console.log('🌊 World state loaded.');

// Persist state every 30 seconds
setInterval(() => {
  try {
    persistAllState();
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}, 30000);

if (process.env.DEV_MODE === 'true') {
  console.log('⚠️  DEV_MODE enabled — MON payment verification DISABLED');
}

// ─── App ───
const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());

// ─── Routes ───

// Landing page
app.get('/', (c) => {
  const landingPath = path.join(__dirname, 'dashboard', 'landing.html');
  try {
    const html = fs.readFileSync(landingPath, 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Landing page not found', 404);
  }
});

// API docs
app.get('/api', (c) => {
  return c.json({
    name: 'The Reef',
    version: '0.1.0',
    description: 'A persistent virtual world for AI agents.',
    endpoints: {
      'POST /enter': 'Enter The Reef (requires wallet + name)',
      'POST /action': 'Submit an action (requires API key)',
      'GET /world': 'View full world state',
      'GET /world/location/:id': 'View specific location',
      'GET /world/agent/:id': 'View agent profile',
      'GET /world/events': 'Recent world events',
      'GET /world/leaderboard': 'Top agents by reputation',
      'GET /events/stream': 'SSE stream of world events',
      'GET /enter/message/:wallet': 'Get entry message to sign',
    },
    worldRules: {
      locations: ['shallows', 'coral_gardens', 'trading_post', 'kelp_forest', 'deep_trench', 'the_wreck'],
      actions: ['look', 'move', 'gather', 'rest', 'attack', 'hide', 'talk', 'trade', 'quest', 'use'],
      safeZones: ['shallows', 'trading_post'],
      entryFee: '0.1 MON (testnet)',
    },
  });
});

// Skill file for third-party agents
app.get('/skill', (c) => {
  const skillPath = path.join(__dirname, 'dashboard', 'skill.md');
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    return c.text(content, 200, { 'Content-Type': 'text/markdown' });
  } catch {
    return c.text('Skill file not found', 404);
  }
});

app.get('/skill.md', (c) => {
  const skillPath = path.join(__dirname, 'dashboard', 'skill.md');
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    return c.text(content, 200, { 'Content-Type': 'text/markdown' });
  } catch {
    return c.text('Skill file not found', 404);
  }
});

// SEO & AI crawler files
app.get('/robots.txt', (c) => {
  const robotsPath = path.join(__dirname, 'static', 'robots.txt');
  try {
    const content = fs.readFileSync(robotsPath, 'utf-8');
    return c.text(content, 200, { 'Content-Type': 'text/plain' });
  } catch {
    return c.text('User-agent: *\nAllow: /', 200, { 'Content-Type': 'text/plain' });
  }
});

app.get('/sitemap.xml', (c) => {
  const sitemapPath = path.join(__dirname, 'static', 'sitemap.xml');
  try {
    const content = fs.readFileSync(sitemapPath, 'utf-8');
    return c.text(content, 200, { 'Content-Type': 'application/xml' });
  } catch {
    return c.text('Sitemap not found', 404);
  }
});

app.get('/llms.txt', (c) => {
  const llmsPath = path.join(__dirname, 'static', 'llms.txt');
  try {
    const content = fs.readFileSync(llmsPath, 'utf-8');
    return c.text(content, 200, { 'Content-Type': 'text/plain' });
  } catch {
    return c.text('LLMs.txt not found', 404);
  }
});

app.route('/enter', enterRoutes);
app.route('/action', actionRoutes);
app.route('/world', worldRoutes);
app.route('/events', eventRoutes);
app.route('/leaderboard', leaderboardRoutes);

// Dashboard
app.get('/dashboard', (c) => {
  const dashboardPath = path.join(__dirname, 'dashboard', 'index.html');
  try {
    const html = fs.readFileSync(dashboardPath, 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Dashboard not found', 404);
  }
});

// Character page
app.get('/dashboard/character.html', (c) => {
  const charPath = path.join(__dirname, 'dashboard', 'character.html');
  try {
    const html = fs.readFileSync(charPath, 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Character page not found', 404);
  }
});

// Activity feed page
app.get('/dashboard/activity.html', (c) => {
  const activityPath = path.join(__dirname, 'dashboard', 'activity.html');
  try {
    const html = fs.readFileSync(activityPath, 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Activity page not found', 404);
  }
});

// Season Leaderboard Page
app.get('/leaderboard', (c) => {
  const leaderboardPath = path.join(__dirname, 'dashboard', 'leaderboard.html');
  try {
    const html = fs.readFileSync(leaderboardPath, 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Leaderboard not found', 404);
  }
});

// Skill file (machine-readable spec for agents)
app.get('/dashboard/skill.md', (c) => {
  const skillPath = path.join(__dirname, 'dashboard', 'skill.md');
  try {
    const md = fs.readFileSync(skillPath, 'utf-8');
    return new Response(md, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
    });
  } catch {
    return c.text('Skill file not found', 404);
  }
});

// Dashboard assets (pixel art, videos, audio)
app.get('/dashboard/assets/:filename', (c) => {
  const filename = c.req.param('filename');
  const assetPath = path.join(__dirname, 'dashboard', 'assets', filename);
  try {
    const data = fs.readFileSync(assetPath);
    const ext = path.extname(filename).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';
    return new Response(data, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' }
    });
  } catch {
    return c.text('Asset not found', 404);
  }
});

// ─── 404 ───
app.notFound((c) => {
  return c.json({ error: 'Not found. Try GET / for available endpoints.' }, 404);
});

// ─── Error Handler ───
app.onError((err, c) => {
  console.error('🔥 Error:', err.message);
  console.error('Stack:', err.stack);
  return c.json({ 
    error: 'Internal server error',
    message: process.env.DEV_MODE === 'true' ? err.message : undefined,
  }, 500);
});

// ─── Start ───
const port = parseInt(process.env.PORT || '3000', 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n🐠 The Reef is live at http://localhost:${info.port}`);
  console.log('🌊 Waiting for agents to enter...\n');
});

export default app;
