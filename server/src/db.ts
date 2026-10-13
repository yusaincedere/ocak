import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS rooms (
    id            TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER NOT NULL
  );
`);

// Old account-based tables from v0.1 are simply left alone if they exist.

export interface RoomRow {
  id: string;
  password_hash: string;
  created_at: number;
  last_used_at: number;
}

export function pruneRooms() {
  const cutoff = Date.now() - config.roomTtlDays * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM rooms WHERE last_used_at < ?').run(cutoff);
}
