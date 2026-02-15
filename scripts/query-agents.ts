import Database from 'better-sqlite3';

const db = new Database('./reef.db');

// Get column names first
const info = db.prepare("PRAGMA table_info(agents)").all();
console.log("Available columns:", (info as any[]).map(c => c.name).join(', '));

const allAgents = db.prepare(`
  SELECT id, name, wallet, location, level, hp, maxHp, lastActionAt 
  FROM agents 
  ORDER BY lastActionAt DESC
`).all() as any[];

console.log('\n🐠 AGENT ACTIVITY REPORT\n');
console.log('Name'.padEnd(20) + 'Level'.padEnd(8) + 'Zone'.padEnd(20) + 'Last Action (UTC)');
console.log('-'.repeat(75));

for (const a of allAgents) {
  const lastAction = a.lastActionAt ? new Date(a.lastActionAt).toISOString().replace('T', ' ').slice(0, 19) : 'never';
  console.log(
    (a.name || 'unnamed').padEnd(20) + 
    `L${a.level}`.padEnd(8) + 
    a.location.padEnd(20) + 
    lastAction
  );
}
console.log(`\nTotal: ${allAgents.length} agents`);
process.exit(0);
