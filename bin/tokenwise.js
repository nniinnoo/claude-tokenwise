#!/usr/bin/env node

import { select, input, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  createSession,
  readSession,
  writeSession,
  listSessions,
  deleteSession,
  estimateTokens,
  parseContextTokens,
} from '../lib/tracker.js';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import ora from 'ora';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal({
  width: process.stdout.columns || 80,
  reflowText: true,
  code: chalk.green,
  codespan: chalk.yellow,
  heading: chalk.bold.cyan,
  firstHeading: chalk.bold.cyan.underline,
  strong: chalk.bold.white,
  em: chalk.italic.magenta,
  blockquote: chalk.dim.italic,
  link: chalk.blue.underline
}));

// ── Custom input with ghost text autocomplete ─────

const AUTOCOMPLETE_RULES = [
  { trigger: 'quit', completion: 'cw', full: 'quitcw' },
  { trigger: 'cw', completion: 'quit', full: 'cwquit' },
  { trigger: 'cw', completion: 'history', full: 'cwhistory' },
];

function promptInput(label) {
  return new Promise((resolve) => {
    const prefix = chalk.cyan('? ') + chalk.bold(label) + ' ';
    process.stdout.write(prefix);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Hide default output — we render manually
    rl.output = { write: () => { } };

    let current = '';

    function render() {
      // Clear line and rewrite
      process.stdout.write(`\r\x1b[K${prefix}${current}`);

      // Check for ghost text
      const rule = AUTOCOMPLETE_RULES.find(
        (r) => r.trigger.startsWith(current) && current.length > 0 && current.length < r.full.length
      );
      if (rule) {
        const ghost = rule.full.slice(current.length);
        process.stdout.write(chalk.dim(ghost));
        // Move cursor back to end of actual input
        process.stdout.write(`\x1b[${ghost.length}D`);
      }
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (chunk) => {
      const key = chunk.toString();

      if (key === '\r' || key === '\n') {
        // Enter
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKeypress);
        process.stdout.write('\n');
        rl.close();
        resolve(current);
      } else if (key === '\t') {
        // Tab — autocomplete
        const rule = AUTOCOMPLETE_RULES.find(
          (r) => r.trigger.startsWith(current) && current.length > 0
        );
        if (rule) {
          current = rule.full;
        }
        render();
      } else if (key === '\x7f' || key === '\b') {
        // Backspace
        current = current.slice(0, -1);
        render();
      } else if (key === '\x03') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        rl.close();
        console.log(chalk.dim('\n\n  Session ended.\n'));
        process.exit(0);
      } else if (key >= ' ' && key <= '~') {
        // Printable character
        current += key;
        render();
      }
    };

    process.stdin.on('data', onKeypress);
    render();
  });
}

const MODES = {
  quick: {
    name: 'Quick',
    color: 'green',
    instruction: 'Be maximally brief. One-line answers when possible. No speculative file reads. Skip explanations unless asked.',
  },
  normal: {
    name: 'Normal',
    color: 'yellow',
    instruction: 'Standard workflow. Read relevant files, make changes, brief status updates.',
  },
  deep: {
    name: 'Deep',
    color: 'red',
    instruction: 'Be thorough. Read all relevant files. Explain reasoning. Consider edge cases. Run tests if available. Verify changes.',
  },
};

const MODE_CHOICES = [
  {
    name: `${chalk.green('Quick')}   ${chalk.dim('— Fast & minimal. Least tokens.')}`,
    value: 'quick',
  },
  {
    name: `${chalk.yellow('Normal')}  ${chalk.dim('— Balanced. Standard workflow.')}`,
    value: 'normal',
  },
  {
    name: `${chalk.red('Deep')}    ${chalk.dim('— Thorough & careful. Most tokens.')}`,
    value: 'deep',
  },
  {
    name: chalk.dim('Exit'),
    value: '__exit',
  },
];

const THINKING_PHRASES = [
  'Thinking',
  'Reasoning',
  'Analyzing',
  'Cogitating',
  'Processing',
  'Considering',
  'Reflecting',
  'Evaluating',
];

function randomPhrase() {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}

function runClaude(prompt, claudeSessionId, silent = false) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (claudeSessionId) {
      args.push('-r', claudeSessionId);
    }

    const startTime = Date.now();
    let currentPhrase = randomPhrase();
    let spinner = null;
    let timer = null;

    if (!silent) {
      spinner = ora({
        text: chalk.dim(`${currentPhrase}...`),
        spinner: {
          interval: 120,
          frames: ['✻', '✼', '✽', '✾', '✿', '❀', '❁', '❂'],
        },
        color: 'cyan',
      }).start();

      let phraseCounter = 0;
      timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        phraseCounter++;
        if (phraseCounter % 4 === 0) {
          currentPhrase = randomPhrase();
        }
        spinner.text = chalk.dim(`${currentPhrase} for ${elapsed}s...`);
      }, 1000);
    }

    const claude = spawn('claude', args, {
      stdio: ['inherit', 'pipe', 'inherit'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    let rawOutput = '';

    claude.stdout.on('data', (data) => {
      rawOutput += data.toString();
    });

    claude.on('close', () => {
      if (!silent) {
        clearInterval(timer);
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        spinner.stopAndPersist({
          symbol: chalk.cyan('✻'),
          text: chalk.dim(`${currentPhrase} took ${elapsed}s`),
        });
        console.log('');
      }

      let text = '';
      let sessionId = null;

      try {
        const json = JSON.parse(rawOutput);
        text = json.result || rawOutput;
        sessionId = json.session_id || null;
      } catch {
        text = rawOutput;
      }

      if (!silent) {
        console.log(marked.parse(text));
      }
      resolve({ text, sessionId });
    });
  });
}

function formatTime(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

// ── History mode ──────────────────────────────────

async function showHistory() {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log(chalk.dim('\n  No sessions found.\n'));
    process.exit(0);
  }

  console.log(chalk.bold('\n  Session history\n'));

  while (true) {
    const currentSessions = listSessions();
    if (currentSessions.length === 0) {
      console.log(chalk.dim('  All sessions cleared.\n'));
      process.exit(0);
    }

    const action = await select({
      message: 'Pick a session',
      choices: [
        ...currentSessions.map((s) => ({
          name: `${chalk.dim(formatTime(s.lastActiveAt).padEnd(8))} ${truncate(s.label, 40).padEnd(42)} ${chalk.dim(`~${(s.totalEstimatedTokens || 0).toLocaleString()} tokens`)}${s.exactTokens ? chalk.dim(` [${s.exactTokens}]`) : ''}`,
          value: s.id,
        })),
        { name: chalk.dim('← Back'), value: '__back' },
      ],
      theme: { prefix: chalk.cyan('?') },
    });

    if (action === '__back') {
      process.exit(0);
    }

    const picked = currentSessions.find((s) => s.id === action);

    const sessionAction = await select({
      message: `"${truncate(picked.label, 30)}"`,
      choices: [
        { name: chalk.green('Resume'), value: 'resume' },
        { name: chalk.red('Delete'), value: 'delete' },
        { name: chalk.dim('← Back'), value: 'back' },
      ],
      theme: { prefix: chalk.cyan('?') },
    });

    if (sessionAction === 'resume') {
      await showSessionHistory(picked);
      return picked;
    } else if (sessionAction === 'delete') {
      const sure = await confirm({
        message: 'Delete this session?',
        default: false,
        theme: { prefix: chalk.red('!') },
      });
      if (sure) {
        deleteSession(picked.id);
        console.log(chalk.dim('  Deleted.\n'));
      }
    }
    // 'back' loops again
  }
}

// ── Manage Sessions mode ──────────────────────────

async function manageSessions() {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log(chalk.dim('\n  No sessions found.\n'));
    return null; // Return to picker
  }

  while (true) {
    const currentSessions = listSessions();
    if (currentSessions.length === 0) {
      console.log(chalk.dim('  All sessions cleared.\n'));
      return null;
    }

    // Immediately show checkboxes corresponding to sessions
    const selections = await checkbox({
      message: 'Select sessions to manage',
      choices: currentSessions.map((s) => ({
        name: `${chalk.dim(formatTime(s.lastActiveAt).padEnd(8))} ${truncate(s.label, 40).padEnd(42)} ${chalk.dim(`~${(s.totalEstimatedTokens || 0).toLocaleString()} tokens`)}${s.exactTokens ? chalk.dim(` [${s.exactTokens}]`) : ''}`,
        value: s.id,
      })),
      theme: { prefix: chalk.cyan('?') },
    });

    if (selections.length === 0) {
      return null; // Go back
    }

    const manageAction = await select({
      message: `Selected ${selections.length} session(s)`,
      choices: [
        { name: chalk.green(selections.length === 1 ? 'Resume / View' : 'View Multiple (Resume First)'), value: 'resume' },
        { name: chalk.red('Delete'), value: 'delete' },
        { name: chalk.dim('← Back'), value: 'back' },
      ],
      theme: { prefix: chalk.cyan('?') },
    });

    if (manageAction === 'resume') {
      for (const id of selections) {
        const picked = currentSessions.find((s) => s.id === id);
        if (selections.length > 1) {
          console.log(chalk.bold(`\n  --- Viewing Session: ${picked.label} ---`));
        }
        await showSessionHistory(picked);
      }
      // Resume the first selected session after viewing
      return currentSessions.find((s) => s.id === selections[0]);
    } else if (manageAction === 'delete') {
      const sure = await confirm({
        message: `Delete ${selections.length} session(s)?`,
        default: false,
        theme: { prefix: chalk.red('!') },
      });
      if (sure) {
        selections.forEach((id) => deleteSession(id));
        console.log(chalk.dim(`  Deleted ${selections.length} session(s).\n`));
      }
    }
  }
}



// ── Show conversation history ─────────────────────

async function showSessionHistory(session) {
  if (!session.tasks || session.tasks.length === 0) {
    console.log(chalk.dim('  No conversation history.\n'));
    return;
  }

  const show = await confirm({
    message: 'Show previous conversation?',
    default: true,
    theme: { prefix: chalk.cyan('?') },
  });

  if (!show) return;

  // Let user pick which prompts to expand
  while (true) {
    const choices = session.tasks.map((t, i) => {
      const modeConfig = MODES[t.mode] || { name: t.mode, color: 'white' };
      return {
        name: chalk.bold.cyan('> ') + t.task + chalk.dim(`  [${modeConfig.name}, ~${(t.estimatedTokens || 0).toLocaleString()} tokens]`),
        value: i,
      };
    });

    choices.push({ name: chalk.dim('← Continue'), value: '__done' });

    const picked = await select({
      message: 'Select a prompt to see its answer',
      choices,
      theme: { prefix: chalk.cyan('?') },
    });

    if (picked === '__done') break;

    const task = session.tasks[picked];
    console.log('');
    console.log(chalk.bold.cyan('  > ') + task.task);
    console.log('');
    if (task.response) {
      console.log(marked.parse(task.response));
    } else {
      console.log(chalk.dim('  (no response saved)'));
    }
    console.log('');
    console.log(chalk.dim('─'.repeat(50)));
    console.log('');
  }
}

// ── Session picker (on start) ─────────────────────

async function pickSession() {
  const sessions = listSessions();

  if (sessions.length === 0) {
    return createSession();
  }

  const choice = await select({
    message: 'Session',
    choices: [
      { name: chalk.green('+ New session'), value: '__new' },
      { name: chalk.blue('⚙ Manage sessions'), value: '__manage' },
      ...sessions.slice(0, 5).map((s) => ({
        name: `${chalk.dim(formatTime(s.lastActiveAt).padEnd(8))} ${truncate(s.label, 40).padEnd(42)} ${chalk.dim(`~${(s.totalEstimatedTokens || 0).toLocaleString()} tokens`)}${s.exactTokens ? chalk.dim(` [${s.exactTokens}]`) : ''}`,
        value: s.id,
      })),
      ...(sessions.length > 5
        ? [{ name: chalk.dim(`  ... ${sessions.length - 5} more (use cw -h)`), value: '__manage' }]
        : []),
    ],
    theme: { prefix: chalk.cyan('?') },
  });

  if (choice === '__new') {
    return createSession();
  }

  if (choice === '__manage') {
    const resumed = await manageSessions();
    if (resumed) {
      return resumed;
    }
    // Return to main pickSession loop directly if back out from manage
    return pickSession();
  }

  const resumed = readSession(choice);
  await showSessionHistory(resumed);
  return resumed;
}

// ── Main prompt loop ──────────────────────────────

async function promptLoop(session) {
  while (true) {
    const task = await promptInput('Prompt:');

    if (!task.trim()) continue;

    const lowerTask = task.trim().toLowerCase();

    // Exit keywords
    if (lowerTask === 'quitcw' || lowerTask === 'cwquit') {
      console.log(chalk.dim('  Session ended.\n'));
      process.exit(0);
    }

    // History keyword
    if (lowerTask === 'cwhistory') {
      const resumed = await manageSessions();
      if (resumed) {
        console.log(chalk.dim(`\n  Switched to session: ${resumed.label}\n`));
        session = resumed; // Update current session context
      }
      continue;
    }

    // Set label from first prompt
    if (session.tasks.length === 0) {
      session.label = task.length > 60 ? task.slice(0, 59) + '…' : task;
    }

    const mode = await select({
      message: 'Mode:',
      choices: MODE_CHOICES,
      theme: { prefix: chalk.cyan('?') },
    });

    if (mode === '__exit') {
      console.log(chalk.dim('\n  Session ended.\n'));
      process.exit(0);
    }

    const modeConfig = MODES[mode];

    console.log('');
    console.log(chalk.dim('  Mode: ') + chalk[modeConfig.color](modeConfig.name));
    console.log('');

    const prompt = `[MODE: ${modeConfig.name.toUpperCase()}] ${modeConfig.instruction}\n\n${task}`;
    const result = await runClaude(prompt, session.claudeSessionId);

    if (result.sessionId) {
      session.claudeSessionId = result.sessionId;
    }

    const tokens = estimateTokens(result.text);
    session.totalEstimatedTokens = (session.totalEstimatedTokens || 0) + tokens;

    // Fetch EXACT token bounds silently
    const contextResult = await runClaude('/context', session.claudeSessionId, true);
    const parsedContext = parseContextTokens(contextResult.text);
    if (parsedContext) {
      session.exactTokens = parsedContext;
    }

    session.tasks.push({
      task,
      mode,
      timestamp: new Date().toISOString(),
      estimatedTokens: tokens,
      response: result.text,
    });
    writeSession(session);

    console.log('\n');
    console.log(chalk.dim('─'.repeat(50)));

    if (session.exactTokens) {
      console.log(
        chalk.dim('  est. ') +
        chalk.bold(`~${tokens.toLocaleString()} tokens`) +
        chalk.dim(' | total: ') +
        chalk.bold(`~${session.totalEstimatedTokens.toLocaleString()} tokens`) +
        chalk.dim(' | context: ') +
        chalk.bold(`${session.exactTokens}`) +
        chalk.dim(' | ctrl+c to exit')
      );
    } else {
      console.log(
        chalk.dim('  est. ') +
        chalk.bold(`~${tokens.toLocaleString()} tokens`) +
        chalk.dim(' | total: ') +
        chalk.bold(`~${session.totalEstimatedTokens.toLocaleString()} tokens`) +
        chalk.dim(' | ctrl+c to exit')
      );
    }

    console.log('');
  }
}

// ── Entry point ───────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  console.log(chalk.bold('\n  cw') + chalk.dim(' — cost-aware Claude Code'));
  console.log(chalk.dim('  ctrl+c to exit\n'));

  // Handle flags
  if (args.includes('-h') || args.includes('--history')) {
    const resumed = await manageSessions();
    if (resumed) {
      console.log(chalk.dim(`  Resuming: ${resumed.label}\n`));
      await promptLoop(resumed);
    }
    return;
  }

  // Normal flow: pick or create session
  const session = await pickSession();
  await promptLoop(session);
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log(chalk.dim('\n  Session ended.\n'));
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
