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

  -- A room's group chat, so it's still there next time (people's text messages only).
  CREATE TABLE IF NOT EXISTS messages (
    room_id  TEXT NOT NULL,
    id       TEXT NOT NULL,
    identity TEXT NOT NULL,
    name     TEXT NOT NULL,
    body     TEXT NOT NULL,
    sent_at  INTEGER NOT NULL,
    PRIMARY KEY (room_id, id)
  );
  CREATE INDEX IF NOT EXISTS messages_by_time ON messages (room_id, sent_at);
`);

// Old account-based tables from v0.1 are simply left alone if they exist.

export interface RoomRow {
  id: string;
  password_hash: string;
  created_at: number;
  last_used_at: number;
}

/** How long chat is kept, and how much of it per room. */
export const CHAT_KEEP_DAYS = 30;
export const CHAT_KEEP_MESSAGES = 200;

export function pruneRooms() {
  const cutoff = Date.now() - config.roomTtlDays * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM rooms WHERE last_used_at < ?').run(cutoff);
  // Chat goes with its room, and after a while anyway.
  db.prepare('DELETE FROM messages WHERE sent_at < ? OR room_id NOT IN (SELECT id FROM rooms)').run(
    Date.now() - CHAT_KEEP_DAYS * 24 * 60 * 60 * 1000,
  );
}
