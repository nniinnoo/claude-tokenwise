import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const SESSIONS_DIR = join(process.cwd(), '.claude', 'sessions');

function ensureDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function createSession(label) {
  ensureDir();
  const session = {
    id: randomUUID(),
    claudeSessionId: null,
    label: label || 'New session',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    totalEstimatedTokens: 0,
    tasks: [],
  };
  writeSession(session);
  return session;
}

export function readSession(id) {
  try {
    const data = readFileSync(join(SESSIONS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function writeSession(session) {
  try {
    ensureDir();
    session.lastActiveAt = new Date().toISOString();
    writeFileSync(
      join(SESSIONS_DIR, `${session.id}.json`),
      JSON.stringify(session, null, 2)
    );
  } catch {
    // silently fail
  }
}

export function listSessions() {
  try {
    ensureDir();
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    const sessions = files
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
    return sessions;
  } catch {
    return [];
  }
}

export function deleteSession(id) {
  try {
    unlinkSync(join(SESSIONS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.round(text.length / 3.5 / 10) * 10;
}
