import { db } from '../src/db';
import { sql } from 'drizzle-orm';

try {
  db.run(sql`ALTER TABLE agents ADD COLUMN equipped_weapon TEXT`);
  console.log('Added equipped_weapon column');
} catch (e: any) {
  if (e.message.includes('duplicate column')) {
    console.log('equipped_weapon column already exists');
  } else {
    console.error(e);
  }
}

try {
  db.run(sql`ALTER TABLE agents ADD COLUMN equipped_armor TEXT`);
  console.log('Added equipped_armor column');
} catch (e: any) {
  if (e.message.includes('duplicate column')) {
    console.log('equipped_armor column already exists');
  } else {
    console.error(e);
  }
}

try {
  db.run(sql`ALTER TABLE agents ADD COLUMN equipped_accessory TEXT`);
  console.log('Added equipped_accessory column');
} catch (e: any) {
  if (e.message.includes('duplicate column')) {
    console.log('equipped_accessory column already exists');
  } else {
    console.error(e);
  }
}

console.log('Done!');
