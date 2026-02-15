#!/usr/bin/env npx tsx
/**
 * Migration: Add lastActionAt column to agents table
 * Run with: npx tsx scripts/migrate-add-lastActionAt.ts
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_URL?.replace('file:', '') || join(__dirname, '../reef.db');

console.log(`Migrating database at: ${dbPath}`);

const db = new Database(dbPath);

// Check if column exists
const columns = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
const hasColumn = columns.some(c => c.name === 'last_action_at');

if (hasColumn) {
  console.log('Column last_action_at already exists. Skipping migration.');
  process.exit(0);
}

console.log('Adding last_action_at column to agents table...');
db.exec('ALTER TABLE agents ADD COLUMN last_action_at INTEGER');

console.log('Migration complete!');
process.exit(0);
