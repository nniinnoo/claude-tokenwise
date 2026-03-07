import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const SESSION_PATH = join(process.cwd(), '.claude', 'session.json');

const DEFAULT_SESSION = {
  startedAt: new Date().toISOString(),
  totalEstimatedTokens: 0,
  tasks: [],
};

export function readSession() {
  try {
    const data = readFileSync(SESSION_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { ...DEFAULT_SESSION };
  }
}

export function writeSession(session) {
  try {
    mkdirSync(dirname(SESSION_PATH), { recursive: true });
    writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
  } catch {
    // silently fail — don't break the workflow
  }
}

export function estimateTokens(text) {
  if (!text) return 0;
  // ~3.5 characters per token for English text (Claude tokenizer approximation)
  return Math.round(text.length / 3.5 / 10) * 10;
}

export function resetSession() {
  writeSession({ ...DEFAULT_SESSION });
}
