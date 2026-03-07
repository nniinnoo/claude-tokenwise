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
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import ora from 'ora';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

const MODEL_DISPLAY = {
  sonnet: 'Sonnet 4.6',
  opus: 'Opus 4.6',
  haiku: 'Haiku 4.5',
};

function displayModelName(key) {
  return MODEL_DISPLAY[key] || key;
}

function readClaudeModel() {
  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    return settings.model || null;
  } catch {
    return null;
  }
}

function writeClaudeModel(model) {
  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    settings.model = model;
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch {
    // silently fail
  }
}
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
  { trigger: 'quit', completion: 'ctw', full: 'quitctw' },
  { trigger: 'ctw', completion: 'quit', full: 'ctwquit' },
  { trigger: 'ctw', completion: 'history', full: 'ctwhistory' },
  { trigger: 'ctw', completion: 'help', full: 'ctwhelp' },
  { trigger: 'ctw', completion: 'cost', full: 'ctwcost' },
  { trigger: 'ctw', completion: 'clear', full: 'ctwclear' },
  { trigger: 'ctw', completion: 'mode', full: 'ctwmode' },
  { trigger: 'ctw', completion: 'model', full: 'ctwmodel' },
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

function runClaude(prompt, claudeSessionId, silent = false, model = null, effort = null) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (claudeSessionId) {
      args.push('-r', claudeSessionId);
    }
    if (model) {
      args.push('--model', model);
    }
    if (effort) {
      args.push('--effort', effort);
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
        ? [{ name: chalk.dim(`  ... ${sessions.length - 5} more (use ctw -h)`), value: '__manage' }]
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
    if (lowerTask === 'quitctw' || lowerTask === 'ctwquit') {
      console.log(chalk.dim('  Session ended.\n'));
      process.exit(0);
    }

    // History keyword
    if (lowerTask === 'ctwhistory') {
      const resumed = await manageSessions();
      if (resumed) {
        console.log(chalk.dim(`\n  Switched to session: ${resumed.label}\n`));
        session = resumed;
      }
      continue;
    }

    // Help keyword
    if (lowerTask === 'ctwhelp') {
      console.log(chalk.bold('\n  Keywords\n'));
      console.log(chalk.cyan('  ctwhelp') + chalk.dim('     Show this help'));
      console.log(chalk.cyan('  ctwcost') + chalk.dim('     Show session token stats'));
      console.log(chalk.cyan('  ctwclear') + chalk.dim('    Start fresh context, keep session'));
      console.log(chalk.cyan('  ctwmode') + chalk.dim('     Change default mode'));
      console.log(chalk.cyan('  ctwmodel') + chalk.dim('    Show/change model'));
      console.log(chalk.cyan('  ctwhistory') + chalk.dim('  Open session manager'));
      console.log(chalk.cyan('  ctwquit') + chalk.dim('     Exit session'));
      console.log('');
      continue;
    }

    // Cost keyword
    if (lowerTask === 'ctwcost') {
      console.log(chalk.bold('\n  Session stats\n'));
      console.log(chalk.dim('  Prompts: ') + chalk.bold(session.tasks.length));
      console.log(chalk.dim('  Est. total: ') + chalk.bold(`~${(session.totalEstimatedTokens || 0).toLocaleString()} tokens`));
      if (session.exactTokens) {
        console.log(chalk.dim('  Context: ') + chalk.bold(session.exactTokens));
      }
      if (session.model) {
        console.log(chalk.dim('  Model: ') + chalk.bold(displayModelName(session.model)));
      }
      console.log('');
      continue;
    }

    // Clear keyword
    if (lowerTask === 'ctwclear') {
      session.claudeSessionId = null;
      console.log(chalk.dim('\n  Context cleared. Next prompt starts a fresh Claude session.\n'));
      continue;
    }

    // Mode keyword
    if (lowerTask === 'ctwmode') {
      const picked = await select({
        message: 'Default mode:',
        choices: [
          ...MODE_CHOICES.filter((c) => c.value !== '__exit'),
          { name: chalk.dim('No default (ask each time)'), value: '__none' },
        ],
        theme: { prefix: chalk.cyan('?') },
      });
      session.defaultMode = picked === '__none' ? null : picked;
      if (session.defaultMode) {
        const mc = MODES[session.defaultMode];
        console.log(chalk.dim('\n  Default mode set to ') + chalk[mc.color](mc.name) + '\n');
      } else {
        console.log(chalk.dim('\n  Default mode cleared.\n'));
      }
      continue;
    }

    // Model keyword — reads/writes ~/.claude/settings.json to stay in sync with Claude's /model
    if (lowerTask === 'ctwmodel') {
      const currentModel = readClaudeModel();
      const models = [
        { key: 'sonnet', label: 'Sonnet', color: 'green', desc: 'Sonnet 4.6 · Best for everyday tasks', hasEffort: true },
        { key: 'opus', label: 'Opus', color: 'red', desc: 'Opus 4.6 · Most capable for complex work', hasEffort: true },
        { key: 'haiku', label: 'Haiku', color: 'yellow', desc: 'Haiku 4.5 · Fastest for quick answers', hasEffort: false },
      ];
      const action = await select({
        message: 'Model:',
        choices: [
          ...models.map((m) => ({
            name: `${chalk[m.color](m.label.padEnd(8))}${chalk.dim('— ' + m.desc)}${currentModel === m.key ? chalk.green(' ✔') : ''}`,
            value: m.key,
          })),
          { name: chalk.dim('Keep current'), value: '__keep' },
        ],
        theme: { prefix: chalk.cyan('?') },
      });
      if (action !== '__keep') {
        const selectedModel = models.find((m) => m.key === action);
        let effort = session.effort || 'medium';
        if (selectedModel.hasEffort) {
          const effortBlocks = { low: '▌', medium: '▌▌▌', high: '▌▌▌▌▌' };
          effort = await select({
            message: 'Effort:',
            choices: [
              { name: `${chalk.dim(effortBlocks.low)}   ${chalk.dim('Low')}`, value: 'low' },
              { name: `${chalk.bold(effortBlocks.medium)} ${chalk.dim('Medium (default)')}`, value: 'medium' },
              { name: `${chalk.bold(effortBlocks.high)} ${chalk.dim('High')}`, value: 'high' },
            ],
            theme: { prefix: chalk.cyan('?') },
          });
        }
        writeClaudeModel(action);
        session.model = action;
        session.effort = effort;
        console.log(
          chalk.dim('  Model: ') + chalk.bold(displayModelName(action)) +
          (selectedModel.hasEffort ? chalk.dim(' · Effort: ') + chalk.bold(effort) : '') +
          '\n'
        );
      } else {
        console.log('');
      }
      continue;
    }

    // Set label from first prompt
    if (session.tasks.length === 0) {
      session.label = task.length > 60 ? task.slice(0, 59) + '…' : task;
    }

    let mode;
    if (session.defaultMode) {
      mode = session.defaultMode;
    } else {
      mode = await select({
        message: 'Mode:',
        choices: MODE_CHOICES,
        theme: { prefix: chalk.cyan('?') },
      });

      if (mode === '__exit') {
        console.log(chalk.dim('\n  Session ended.\n'));
        process.exit(0);
      }
    }

    const modeConfig = MODES[mode];

    console.log('');
    const activeModel = session.model || readClaudeModel();
    console.log(
      chalk.dim('  Mode: ') + chalk[modeConfig.color](modeConfig.name) +
      (activeModel ? chalk.dim('  Model: ') + chalk.bold(displayModelName(activeModel)) : '')
    );
    console.log('');

    const prompt = `[MODE: ${modeConfig.name.toUpperCase()}] ${modeConfig.instruction}\n\n${task}`;
    const result = await runClaude(prompt, session.claudeSessionId, false, session.model, session.effort);

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

    console.log(
      chalk.dim('  est. ') +
      chalk.bold(`~${tokens.toLocaleString()} tokens`) +
      chalk.dim(' | total: ') +
      chalk.bold(`~${session.totalEstimatedTokens.toLocaleString()} tokens`) +
      (session.exactTokens ? chalk.dim(' | context: ') + chalk.bold(session.exactTokens) : '')
    );
    const displayModel = session.model || readClaudeModel();
    console.log(
      (displayModel ? chalk.dim('  model: ') + chalk.bold(displayModelName(displayModel)) : '') +
      chalk.dim((displayModel ? ' | ' : '  ') + 'ctrl+c to exit')
    );

    console.log('');
  }
}

// ── Entry point ───────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  console.log(chalk.bold('\n  ctw') + chalk.dim(` v${pkg.version} — cost-aware Claude Code`));
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
