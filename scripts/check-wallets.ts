import { db, schema } from '../src/db/index.js';

const agents = db.select().from(schema.agents).all();
const squad = agents.filter(a => a.name?.includes('Squad'));
squad.forEach(a => console.log(`${a.name}: wallet="${a.wallet}"`));
