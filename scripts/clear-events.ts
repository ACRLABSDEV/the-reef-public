import { db } from '../src/db';
import * as schema from '../src/db/schema';

// Clear events table
db.delete(schema.worldEvents).run();
console.log('Events table cleared');
