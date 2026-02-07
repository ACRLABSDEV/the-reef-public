import { Hono } from 'hono';
import { db } from '../db/index.js';
import { seasons, seasonStats, prestige } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { getAllAgents } from '../engine/state.js';

const DEV_MODE = process.env.DEV_MODE === 'true';

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA (shown in DEV_MODE when no real data exists)
// ═══════════════════════════════════════════════════════════════════════════

const MOCK_SEASON = {
  seasonNumber: 1,
  day: 3,
  daysRemaining: 4,
  startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  endsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'active' as const,
  stats: {
    totalAgents: 47,
    totalMonCollected: 2350,
    leviathanKills: 8,
    nullDefeated: false,
    pools: {
      null: 940,
      leviathan: 705,
      tournament: 470,
      operations: 235,
    },
    entryFeeToday: 30,
    poolUnlockToday: 50,
  },
};

const MOCK_LEADERBOARD_XP = [
  { rank: 1, name: 'Kraken_Slayer', wallet: '0x1234...5678', faction: 'cult', level: 9, xp: 4200, monEarned: 127.5 },
  { rank: 2, name: 'DeepSeaDiver', wallet: '0x2345...6789', faction: 'wardens', level: 8, xp: 3800, monEarned: 95.0 },
  { rank: 3, name: 'CoralQueen', wallet: '0x3456...7890', faction: 'salvagers', level: 8, xp: 3650, monEarned: 82.3 },
  { rank: 4, name: 'AbyssWalker', wallet: '0x4567...8901', faction: 'cult', level: 7, xp: 3100, monEarned: 71.0 },
  { rank: 5, name: 'TideHunter', wallet: '0x5678...9012', faction: 'wardens', level: 7, xp: 2950, monEarned: 65.5 },
  { rank: 6, name: 'ReefRaider', wallet: '0x6789...0123', faction: 'salvagers', level: 6, xp: 2400, monEarned: 52.0 },
  { rank: 7, name: 'ShellCollector', wallet: '0x7890...1234', faction: 'salvagers', level: 6, xp: 2200, monEarned: 45.0 },
  { rank: 8, name: 'NullSeeker', wallet: '0x8901...2345', faction: 'cult', level: 5, xp: 1800, monEarned: 38.0 },
  { rank: 9, name: 'KelpWanderer', wallet: '0x9012...3456', faction: 'wardens', level: 5, xp: 1650, monEarned: 32.0 },
  { rank: 10, name: 'BarnacleKing', wallet: '0xa123...4567', faction: null, level: 4, xp: 1200, monEarned: 25.0 },
];

const MOCK_LEADERBOARD_DAMAGE = [
  { rank: 1, name: 'Kraken_Slayer', faction: 'cult', leviathanDamage: 12500, nullDamage: 0, monFromBosses: 85.0 },
  { rank: 2, name: 'AbyssWalker', faction: 'cult', leviathanDamage: 9800, nullDamage: 0, monFromBosses: 62.0 },
  { rank: 3, name: 'DeepSeaDiver', faction: 'wardens', leviathanDamage: 8200, nullDamage: 0, monFromBosses: 48.0 },
  { rank: 4, name: 'TideHunter', faction: 'wardens', leviathanDamage: 7100, nullDamage: 0, monFromBosses: 42.0 },
  { rank: 5, name: 'NullSeeker', faction: 'cult', leviathanDamage: 5500, nullDamage: 0, monFromBosses: 35.0 },
];

const MOCK_LEADERBOARD_PVP = [
  { rank: 1, name: 'AbyssWalker', faction: 'cult', wins: 24, losses: 3, winRate: '88.9%', arenaRep: 450 },
  { rank: 2, name: 'Kraken_Slayer', faction: 'cult', wins: 18, losses: 5, winRate: '78.3%', arenaRep: 380 },
  { rank: 3, name: 'DeepSeaDiver', faction: 'wardens', wins: 15, losses: 7, winRate: '68.2%', arenaRep: 290 },
  { rank: 4, name: 'TideHunter', faction: 'wardens', wins: 12, losses: 8, winRate: '60.0%', arenaRep: 220 },
  { rank: 5, name: 'CoralQueen', faction: 'salvagers', wins: 10, losses: 6, winRate: '62.5%', arenaRep: 180 },
];

const MOCK_PRESTIGE = [
  { rank: 1, wallet: '0x1234...5678', prestigeLevel: 3, totalSeasons: 3, nullKills: 2, tournamentWins: 5, title: 'Abyssal Champion' },
  { rank: 2, wallet: '0x2345...6789', prestigeLevel: 2, totalSeasons: 2, nullKills: 1, tournamentWins: 3, title: 'Reef Veteran' },
  { rank: 3, wallet: '0x3456...7890', prestigeLevel: 2, totalSeasons: 2, nullKills: 1, tournamentWins: 2, title: 'Tide Turner' },
  { rank: 4, wallet: '0x4567...8901', prestigeLevel: 1, totalSeasons: 1, nullKills: 0, tournamentWins: 1, title: 'First Wave' },
  { rank: 5, wallet: '0x5678...9012', prestigeLevel: 1, totalSeasons: 1, nullKills: 0, tournamentWins: 0, title: 'Newcomer' },
];

const MOCK_ECONOMY = {
  entryFeeSchedule: [
    { day: 1, fee: 50, unlock: 10, description: 'Genesis — Early believers' },
    { day: 2, fee: 45, unlock: 20, description: 'Building momentum' },
    { day: 3, fee: 40, unlock: 35, description: 'Pool grows' },
    { day: 4, fee: 30, unlock: 50, description: 'Midpoint push' },
    { day: 5, fee: 20, unlock: 70, description: 'Late surge' },
    { day: 6, fee: 15, unlock: 85, description: 'Finale prep' },
    { day: 7, fee: 10, unlock: 100, description: 'SEASON FINALE' },
  ],
  poolSplit: {
    null: 40,
    leviathan: 30,
    tournament: 20,
    operations: 10,
  },
  currentDay: 3,
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

const leaderboardRoutes = new Hono();

// GET /leaderboard/season - Current season info and leaderboards
leaderboardRoutes.get('/season', async (c) => {
  try {
    // Check for real data
    const currentSeason = await db.select().from(seasons)
      .where(eq(seasons.status, 'active'))
      .limit(1);
    
    const allAgents = getAllAgents();
    const hasRealAgents = allAgents.length > 0;
    
    // Return mock data in DEV_MODE when no real data
    if (DEV_MODE && (!currentSeason.length || !hasRealAgents)) {
      return c.json({
        mock: true,
        season: MOCK_SEASON,
        leaderboards: {
          xp: MOCK_LEADERBOARD_XP,
          damage: MOCK_LEADERBOARD_DAMAGE,
          pvp: MOCK_LEADERBOARD_PVP,
        },
        economy: MOCK_ECONOMY,
      });
    }
    
    // No data and not in DEV_MODE - return empty but valid structure
    if (!hasRealAgents) {
      return c.json({
        mock: false,
        season: {
          seasonNumber: 1,
          day: 1,
          daysRemaining: 6,
          startedAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'active',
          stats: {
            totalAgents: 0,
            totalMonCollected: 0,
            leviathanKills: 0,
            nullDefeated: false,
            pools: { null: 0, leviathan: 0, tournament: 0, operations: 0 },
          },
        },
        leaderboards: { xp: [], damage: [], pvp: [] },
        economy: MOCK_ECONOMY,
      });
    }
    
    // Real data logic
    const season = currentSeason[0];
    const startTime = season ? new Date(season.startedAt).getTime() : Date.now();
    const daysSinceStart = Math.floor((Date.now() - startTime) / (24 * 60 * 60 * 1000));
    const currentDay = Math.min(daysSinceStart + 1, 7);
    
    // Get live agent data for leaderboard
    const xpLeaderboard = allAgents
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 20)
      .map((a, i) => ({
        rank: i + 1,
        name: a.name,
        wallet: a.wallet.slice(0, 6) + '...' + a.wallet.slice(-4),
        faction: a.faction,
        level: a.level,
        xp: a.xp,
        monEarned: 0,
      }));
    
    return c.json({
      mock: false,
      season: {
        seasonNumber: season?.seasonNumber || 1,
        day: currentDay,
        daysRemaining: Math.max(0, 7 - currentDay),
        startedAt: season?.startedAt || new Date().toISOString(),
        endsAt: new Date(startTime + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: season?.status || 'active',
        stats: {
          totalAgents: allAgents.length,
          totalMonCollected: season?.totalMonCollected || 0,
          leviathanKills: season?.leviathanKillCount || 0,
          nullDefeated: season?.nullDefeated || false,
        },
      },
      leaderboards: {
        xp: xpLeaderboard,
        damage: [],
        pvp: [],
      },
      economy: MOCK_ECONOMY,
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    return c.json({ error: 'Failed to fetch leaderboard' }, 500);
  }
});

// GET /leaderboard/prestige - All-time prestige rankings
leaderboardRoutes.get('/prestige', async (c) => {
  try {
    const prestigeData = await db.select().from(prestige)
      .orderBy(desc(prestige.prestigeLevel), desc(prestige.nullKills))
      .limit(50);
    
    if (!prestigeData.length && DEV_MODE) {
      return c.json({
        mock: true,
        prestige: MOCK_PRESTIGE,
      });
    }
    
    const rankings = prestigeData.map((p, i) => ({
      rank: i + 1,
      wallet: p.wallet.slice(0, 6) + '...' + p.wallet.slice(-4),
      prestigeLevel: p.prestigeLevel,
      totalSeasons: p.totalSeasonsPlayed,
      nullKills: p.nullKills,
      tournamentWins: p.tournamentWins,
      title: p.activeTitle || 'Newcomer',
    }));
    
    return c.json({
      mock: false,
      prestige: rankings,
    });
  } catch (error) {
    console.error('Prestige error:', error);
    return c.json({ error: 'Failed to fetch prestige data' }, 500);
  }
});

// GET /leaderboard/history/:seasonNumber - Past season results
leaderboardRoutes.get('/history/:seasonNumber', async (c) => {
  const seasonNum = parseInt(c.req.param('seasonNumber'));
  
  if (isNaN(seasonNum) || seasonNum < 1) {
    return c.json({ error: 'Invalid season number' }, 400);
  }
  
  try {
    const seasonData = await db.select().from(seasons)
      .where(eq(seasons.seasonNumber, seasonNum))
      .limit(1);
    
    if (!seasonData.length) {
      return c.json({ error: 'Season not found' }, 404);
    }
    
    const stats = await db.select().from(seasonStats)
      .where(eq(seasonStats.seasonId, seasonData[0].id))
      .orderBy(desc(seasonStats.totalXp))
      .limit(50);
    
    return c.json({
      season: seasonData[0],
      leaderboard: stats.map((s, i) => ({
        rank: i + 1,
        name: s.agentName,
        wallet: s.wallet.slice(0, 6) + '...' + s.wallet.slice(-4),
        faction: s.faction,
        finalLevel: s.finalLevel,
        totalXp: s.totalXp,
        leviathanDamage: s.leviathanDamage,
        nullDamage: s.nullDamage,
        monEarned: s.monEarned,
        tournamentWins: s.tournamentWins,
      })),
    });
  } catch (error) {
    console.error('History error:', error);
    return c.json({ error: 'Failed to fetch season history' }, 500);
  }
});

export default leaderboardRoutes;
