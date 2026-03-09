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
import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import ora from 'ora';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

const MODEL_DISPLAY = {
  sonnet: 'Sonnet 4.6',
  opus: 'Opus 4.6',
  haiku: 'Haiku 4.5',
};

const MODEL_CONTEXT_WINDOW = {
  sonnet: 200000,
  opus: 200000,
  haiku: 200000,
};

function getContextWindow(model) {
  return MODEL_CONTEXT_WINDOW[model] || 200000;
}

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

// Prompt history (persists across the session)
const promptHistory = [];
let historyIndex = -1;

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
    let cursorPos = 0;
    historyIndex = -1;
    let savedInput = ''; // save current input when browsing history

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

      // Position cursor correctly
      const cursorOffset = current.length - cursorPos;
      if (cursorOffset > 0) {
        process.stdout.write(`\x1b[${cursorOffset}D`);
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
        if (current.trim()) {
          promptHistory.unshift(current); // add to history
        }
        resolve(current);
      } else if (key === '\t') {
        // Tab — autocomplete
        const rule = AUTOCOMPLETE_RULES.find(
          (r) => r.trigger.startsWith(current) && current.length > 0
        );
        if (rule) {
          current = rule.full;
          cursorPos = current.length;
        }
        render();
      } else if (key === '\x1b[A') {
        // Up arrow — previous history
        if (promptHistory.length > 0) {
          if (historyIndex === -1) {
            savedInput = current; // save what user was typing
          }
          if (historyIndex < promptHistory.length - 1) {
            historyIndex++;
            current = promptHistory[historyIndex];
            cursorPos = current.length;
          }
        }
        render();
      } else if (key === '\x1b[B') {
        // Down arrow — next history
        if (historyIndex > 0) {
          historyIndex--;
          current = promptHistory[historyIndex];
          cursorPos = current.length;
        } else if (historyIndex === 0) {
          historyIndex = -1;
          current = savedInput;
          cursorPos = current.length;
        }
        render();
      } else if (key === '\x1b[D') {
        // Left arrow
        if (cursorPos > 0) cursorPos--;
        render();
      } else if (key === '\x1b[C') {
        // Right arrow
        if (cursorPos < current.length) cursorPos++;
        render();
      } else if (key === '\x1b[H' || key === '\x01') {
        // Home or Ctrl+A
        cursorPos = 0;
        render();
      } else if (key === '\x1b[F' || key === '\x05') {
        // End or Ctrl+E
        cursorPos = current.length;
        render();
      } else if (key === '\x1b\x7f' || key === '\x1b\b') {
        // Alt+Backspace — delete word backward
        if (cursorPos > 0) {
          const before = current.slice(0, cursorPos);
          const after = current.slice(cursorPos);
          // Find start of previous word
          const trimmed = before.trimEnd();
          const lastSpace = trimmed.lastIndexOf(' ');
          const newBefore = lastSpace === -1 ? '' : before.slice(0, lastSpace + 1);
          current = newBefore + after;
          cursorPos = newBefore.length;
        }
        render();
      } else if (key === '\x17') {
        // Ctrl+W — delete word backward (alternative)
        if (cursorPos > 0) {
          const before = current.slice(0, cursorPos);
          const after = current.slice(cursorPos);
          const trimmed = before.trimEnd();
          const lastSpace = trimmed.lastIndexOf(' ');
          const newBefore = lastSpace === -1 ? '' : before.slice(0, lastSpace + 1);
          current = newBefore + after;
          cursorPos = newBefore.length;
        }
        render();
      } else if (key === '\x15') {
        // Ctrl+U — delete entire line
        current = current.slice(cursorPos);
        cursorPos = 0;
        render();
      } else if (key === '\x7f' || key === '\b') {
        // Backspace — delete char before cursor
        if (cursorPos > 0) {
          current = current.slice(0, cursorPos - 1) + current.slice(cursorPos);
          cursorPos--;
        }
        render();
      } else if (key === '\x03') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        rl.close();
        console.log(chalk.dim('\n\n  Session ended.\n'));
        process.exit(0);
      } else if (key >= ' ' && key <= '~') {
        // Printable character — insert at cursor
        current = current.slice(0, cursorPos) + key + current.slice(cursorPos);
        cursorPos++;
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
    instruction: 'Max brevity. 1-line answers. No extra reads.',
  },
  normal: {
    name: 'Normal',
    color: 'yellow',
    instruction: 'Balanced. Read needed files, make changes.',
  },
  deep: {
    name: 'Deep',
    color: 'red',
    instruction: 'Thorough. Read all files. Explain. Test. Verify.',
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

// ── Tool detail display ───────────────────────────
function displayToolDetails(toolName, toolInput) {
  if (toolName === 'Bash') {
    console.log(chalk.dim('  Command: ') + chalk.white(toolInput.command || ''));
    if (toolInput.description) {
      console.log(chalk.dim('  Desc:    ') + toolInput.description);
    }
  } else if (toolName === 'Write') {
    console.log(chalk.dim('  File: ') + chalk.white(toolInput.file_path || ''));
    if (toolInput.content) {
      const lines = toolInput.content.split('\n');
      const preview = lines.slice(0, 8).join('\n');
      const suffix = lines.length > 8 ? chalk.dim(`\n  ... +${lines.length - 8} more lines`) : '';
      console.log(chalk.dim('  Content:'));
      preview.split('\n').forEach(l => console.log(chalk.white('    ' + l)));
      if (suffix) console.log(suffix);
    }
  } else if (toolName === 'Edit') {
    console.log(chalk.dim('  File: ') + chalk.white(toolInput.file_path || ''));
    if (toolInput.old_string) {
      console.log(chalk.dim('  - ') + chalk.red(truncate(toolInput.old_string, 120)));
      console.log(chalk.dim('  + ') + chalk.green(truncate(toolInput.new_string || '', 120)));
    }
  } else if (toolName === 'Read') {
    console.log(chalk.dim('  File: ') + chalk.white(toolInput.file_path || ''));
  } else {
    const inputStr = JSON.stringify(toolInput, null, 2);
    const preview = inputStr.length > 400 ? inputStr.slice(0, 400) + '...' : inputStr;
    console.log(chalk.dim('  Input: ') + preview);
  }
}

// Tracks tools the user has auto-approved for the session
const autoApprovedTools = new Set();

let currentAbortController = null;
let pendingCustom = false;
let pendingCustomContext = null;

// ── Response cache (exact-match, session-scoped) ──
const responseCache = new Map();
const CACHE_MAX = 50;

function cacheKey(prompt, mode) {
  return createHash('md5').update(`${mode}:${prompt.trim().toLowerCase()}`).digest('hex');
}

function getCached(prompt, mode) {
  const key = cacheKey(prompt, mode);
  return responseCache.get(key) || null;
}

function setCache(prompt, mode, response) {
  const key = cacheKey(prompt, mode);
  responseCache.set(key, { text: response, cachedAt: Date.now() });
  // Evict oldest if over limit
  if (responseCache.size > CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
}

// ── Context compaction ────────────────────────────
// When context window usage exceeds threshold, summarize the conversation
// and start a fresh session with the summary as context.
const COMPACT_THRESHOLD = 0.4; // 40% of context window

async function compactContext(session, model, effort) {
  const tasks = session.tasks || [];
  if (tasks.length < 2) return false;

  // Build a concise summary of what was done
  const summaryParts = tasks.map((t, i) => {
    const response = (t.response || '').slice(0, 200);
    return `Turn ${i + 1} [${t.mode}]: "${t.task}" → ${response}${t.response?.length > 200 ? '...' : ''}`;
  });

  const summaryPrompt = `Summarize this conversation in under 300 words. Focus on: what was asked, what was done, what files were changed, current state. Skip pleasantries.\n\n${summaryParts.join('\n')}`;

  // Use a lightweight call (no tool approval, no streaming) to summarize
  const summaryResult = await runClaude(summaryPrompt, null, true, 'haiku', 'low');

  if (!summaryResult.text) return false;

  // Start a new Claude session with the summary as context
  const contextPrompt = `[CONTEXT FROM PREVIOUS CONVERSATION]\n${summaryResult.text}\n[END CONTEXT]\n\nContinue from where we left off. You have full context above.`;
  const freshResult = await runClaude(contextPrompt, null, true, model, effort);

  if (freshResult.sessionId) {
    session.claudeSessionId = freshResult.sessionId;
    session.compactedAt = new Date().toISOString();
    session.compactions = (session.compactions || 0) + 1;
    writeSession(session);
    return true;
  }
  return false;
}

// ── Prompt compression ────────────────────────────
// Lightweight text cleanup to reduce prompt token count
function compressPrompt(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')         // collapse excessive newlines
    .replace(/[ \t]{2,}/g, ' ')          // collapse whitespace
    .replace(/^\s+|\s+$/g, '')           // trim
    .replace(/please\s+/gi, '')          // remove filler
    .replace(/\bcan you\b/gi, '')        // remove filler
    .replace(/\bcould you\b/gi, '')      // remove filler
    .replace(/\bi would like you to\b/gi, '') // remove filler
    .replace(/\bi want you to\b/gi, '')  // remove filler
    .replace(/\bI need you to\b/gi, '')  // remove filler
    .replace(/\s{2,}/g, ' ')             // re-collapse after removals
    .trim();
}

// ── Tool approval handler ─────────────────────────
async function handleToolApproval(toolName, toolInput, context) {
  // Handle clarifying questions separately
  if (toolName === 'AskUserQuestion') {
    return await handleClarifyingQuestions(toolInput);
  }

  // Auto-approve if user previously said "allow all" for this tool
  if (autoApprovedTools.has(toolName)) {
    return { behavior: 'allow', updatedInput: toolInput };
  }

  console.log('');
  console.log(chalk.yellow('⚡ ') + chalk.bold(toolName));
  displayToolDetails(toolName, toolInput);
  console.log('');

  const action = await select({
    message: '',
    choices: [
      { name: chalk.green('✓ Allow'), value: 'allow' },
      { name: chalk.green('✓ Allow all ') + chalk.dim(`${toolName}`) + chalk.dim(' for this session'), value: 'allow_all' },
      { name: chalk.red('✗ Deny'), value: 'deny' },
      { name: chalk.blue('✎ Custom') + chalk.dim(' — tell Claude what to do instead'), value: 'custom' },
    ],
    theme: { prefix: chalk.yellow('?') },
  });

  if (action === 'allow') {
    return { behavior: 'allow', updatedInput: toolInput };
  }

  if (action === 'allow_all') {
    autoApprovedTools.add(toolName);
    console.log(chalk.dim(`  Auto-approving ${toolName} for this session.`));
    return { behavior: 'allow', updatedInput: toolInput };
  }

  if (action === 'custom') {
    // Can't capture text input inside SDK callback (stdin conflict).
    // Set flag, deny the tool, let SDK finish its turn. Main loop will
    // prompt for custom instruction and send as follow-up in same session.
    pendingCustom = true;
    pendingCustomContext = { toolName, toolInput };
    return { behavior: 'deny', message: 'Rejected. User will give alternative instructions. Just say "Waiting for your instructions." — nothing else.' };
  }

  // deny
  return { behavior: 'deny', message: 'User denied this action.' };
}

// ── Handle AskUserQuestion tool ───────────────────
async function handleClarifyingQuestions(toolInput) {
  const answers = {};
  const questions = toolInput.questions || [];

  for (const q of questions) {
    console.log('');
    console.log(chalk.cyan('? ') + chalk.bold(q.question));

    const options = q.options || [];
    const choices = [
      ...options.map((opt) => ({
        name: chalk.bold(opt.label) + (opt.description ? chalk.dim(` — ${opt.description}`) : ''),
        value: opt.label,
      })),
      { name: chalk.blue('✎ Custom') + chalk.dim(' — type your own answer'), value: '__custom' },
    ];

    if (q.multiSelect) {
      const selected = await checkbox({
        message: q.header || 'Select:',
        choices: choices.filter(c => c.value !== '__custom'), // checkbox doesn't mix well with custom
        theme: { prefix: chalk.cyan('?') },
      });
      if (selected.length === 0) {
        // No selection — let user type custom
        const custom = await input({ message: 'Your answer:', theme: { prefix: chalk.blue('✎') } });
        answers[q.question] = custom.trim() || selected.join(', ');
      } else {
        answers[q.question] = selected.join(', ');
      }
    } else {
      const selected = await select({
        message: q.header || 'Choose:',
        choices,
        theme: { prefix: chalk.cyan('?') },
      });

      if (selected === '__custom') {
        const custom = await input({ message: 'Your answer:', theme: { prefix: chalk.blue('✎') } });
        answers[q.question] = custom.trim();
      } else {
        answers[q.question] = selected;
      }
    }
  }

  return {
    behavior: 'allow',
    updatedInput: { questions, answers },
  };
}

// ── Run Claude via Agent SDK ──────────────────────
async function runClaude(prompt, claudeSessionId, silent = false, model = null, effort = null) {
  const abortController = new AbortController();
  currentAbortController = abortController;

  const options = {
    includePartialMessages: !silent,
    sigint: 'ignore',
    abortController,
    // Use 'default' mode so unapproved tools route to canUseTool instead of auto-denying
    permissionMode: 'default',
    // Don't load external settings that might override permissions
    settingSources: [],
  };

  // Session resumption
  if (claudeSessionId) {
    options.resume = claudeSessionId;
  }

  // Model
  if (model) {
    options.model = model;
  }

  // Effort
  if (effort) {
    options.effort = effort;
  }

  // Tool approval callback (only for non-silent/interactive runs)
  if (!silent) {
    options.canUseTool = handleToolApproval;
  }

  const startTime = Date.now();
  let currentPhrase = randomPhrase();
  let spinner = null;
  let timer = null;
  let hasStartedStreaming = false;
  let sessionId = null;
  let resultText = '';
  let aborted = false;

  // Listen for Escape key to interrupt
  let escListener = null;
  if (!silent) {
    escListener = (chunk) => {
      const key = chunk.toString();
      if (key === '\x1b' && chunk.length === 1) {
        // Escape key (single byte, not part of escape sequence)
        aborted = true;
        abortController.abort();
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', escListener);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', escListener);
  }

  if (!silent) {
    spinner = ora({
      text: chalk.dim(`${currentPhrase}...`) + chalk.dim.italic('  esc to cancel'),
      spinner: {
        interval: 120,
        frames: ['✻', '✼', '✽', '✾', '✿', '❀', '❁', '❂'],
      },
      color: 'cyan',
    }).start();

    let phraseCounter = 0;
    timer = setInterval(() => {
      if (hasStartedStreaming) return;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      phraseCounter++;
      if (phraseCounter % 4 === 0) {
        currentPhrase = randomPhrase();
      }
      spinner.text = chalk.dim(`${currentPhrase} for ${elapsed}s...`) + chalk.dim.italic('  esc to cancel');
    }, 1000);
  }

  // Cleanup escape listener helper
  function cleanupEsc() {
    if (escListener) {
      process.stdin.removeListener('data', escListener);
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      escListener = null;
    }
  }

  try {
    let inTool = false;
    let streamedText = '';
    let usage = { input_tokens: 0, output_tokens: 0 };
    let rateLimit = null;

    for await (const message of query({ prompt, options })) {
      // Capture session ID from init message
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
        continue;
      }

      // Capture rate limit info
      if (message.type === 'rate_limit_event' && message.rate_limit_info) {
        rateLimit = message.rate_limit_info;
        continue;
      }

      // Handle streaming events (real-time text output)
      if (message.type === 'stream_event' && !silent) {
        const event = message.event;

        // Capture token usage from stream (as fallback)
        if (event.type === 'message_start' && event.message?.usage) {
          const u = event.message.usage;
          usage.input_tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        }
        if (event.type === 'message_delta' && event.usage) {
          usage.output_tokens = event.usage.output_tokens || 0;
        }

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block?.type === 'tool_use') {
            inTool = true;
            // Pause esc listener so inquirer can use stdin for approval
            cleanupEsc();
            // Stop spinner when tool starts (approval prompt will show)
            if (spinner && spinner.isSpinning) {
              spinner.stop();
              process.stdout.write('\r\x1b[K'); // clear spinner line
            }
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && !inTool) {
            if (!hasStartedStreaming) {
              hasStartedStreaming = true;
              if (spinner && spinner.isSpinning) {
                clearInterval(timer);
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                spinner.stopAndPersist({
                  symbol: chalk.cyan('✻'),
                  text: chalk.dim(`${currentPhrase} took ${elapsed}s`),
                });
                console.log('');
              }
            }
            const text = delta.text || '';
            streamedText += text;
            process.stdout.write(text);
          }
        } else if (event.type === 'content_block_stop') {
          if (inTool) {
            inTool = false;
            // Re-enable esc listener and restart spinner after tool completes
            if (!hasStartedStreaming && spinner) {
              escListener = (chunk) => {
                const key = chunk.toString();
                if (key === '\x1b' && chunk.length === 1) {
                  aborted = true;
                  abortController.abort();
                  cleanupEsc();
                }
              };
              process.stdin.setRawMode(true);
              process.stdin.resume();
              process.stdin.on('data', escListener);
              spinner.start();
            }
          }
        }
        continue;
      }

      // Capture result — has the best usage data
      if (message.type === 'result') {
        resultText = message.result || '';
        if (!sessionId) {
          sessionId = message.session_id || null;
        }
        // Result message has cumulative usage across all turns
        if (message.usage) {
          const u = message.usage;
          usage.input_tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          usage.output_tokens = u.output_tokens || 0;
        }
        if (message.total_cost_usd != null) {
          usage.cost_usd = message.total_cost_usd;
        }
      }
    }

    // If we streamed text, use that; otherwise use result
    if (streamedText) {
      resultText = streamedText;
    }

    cleanupEsc();

    // Clean up spinner if it never transitioned to streaming
    if (!silent && !hasStartedStreaming) {
      clearInterval(timer);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (spinner && spinner.isSpinning) {
        spinner.stopAndPersist({
          symbol: chalk.cyan('✻'),
          text: chalk.dim(`${currentPhrase} took ${elapsed}s`),
        });
      }
      console.log('');
      // Render as markdown since we didn't stream
      if (resultText) {
        console.log(marked.parse(resultText));
      }
    } else if (!silent && streamedText) {
      // Add newline after streamed text
      console.log('');
    }

    return { text: resultText, sessionId, usage, rateLimit };
  } catch (err) {
    cleanupEsc();
    const wasAborted = aborted || pendingCustom || abortController.signal.aborted;
    if (!silent) {
      clearInterval(timer);
      if (spinner && spinner.isSpinning) {
        if (wasAborted) {
          spinner.stopAndPersist({
            symbol: chalk.yellow('⊘'),
            text: chalk.dim('Cancelled'),
          });
        } else {
          spinner.fail(chalk.red('Error'));
        }
      }
      if (!wasAborted) {
        console.error(chalk.red(`  ${err.message || err}`));
      }
    }
    return { text: resultText || '', sessionId, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

// ── Lightweight CLI spawn for /context (with timeout) ─────────────
function runClaudeCli(prompt, claudeSessionId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (claudeSessionId) {
      args.push('-r', claudeSessionId);
    }

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    let rawOutput = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        claude.kill();
        resolve({ text: '' });
      }
    }, timeoutMs);

    claude.stdout.on('data', (data) => { rawOutput += data.toString(); });
    claude.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let text = '';
      try {
        const json = JSON.parse(rawOutput);
        text = json.result || rawOutput;
      } catch {
        text = rawOutput;
      }
      resolve({ text });
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

function formatResetTime(unixTs) {
  const d = new Date(unixTs * 1000);
  const now = new Date();
  const diffMs = d - now;
  if (diffMs <= 0) return 'now';
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const diffHrs = Math.floor(diffMs / 3600000);
  if (diffHrs < 24) return `in ${diffHrs}h`;
  return `in ${Math.floor(diffMs / 86400000)}d`;
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
  let lastMode = null; // Track last used mode for follow-up detection

  // Seed prompt history from current session + recent sessions
  if (promptHistory.length === 0) {
    // Current session tasks first (most recent on top)
    const currentTasks = (session.tasks || []).map(t => t.task).reverse();
    // Then grab from other recent sessions
    const otherSessions = listSessions()
      .filter(s => s.id !== session.id)
      .slice(0, 5);
    const otherTasks = otherSessions
      .flatMap(s => (s.tasks || []).map(t => t.task))
      .reverse();
    // Deduplicate, current session first
    const seen = new Set();
    for (const t of [...currentTasks, ...otherTasks]) {
      if (t && !seen.has(t)) {
        seen.add(t);
        promptHistory.push(t);
      }
    }
  }

  while (true) {
    const task = await promptInput(lastMode ? 'Reply:' : 'Prompt:');

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
      console.log(chalk.cyan('  ctwclear') + chalk.dim('    Clear context & cache, keep session'));
      console.log(chalk.cyan('  ctwmode') + chalk.dim('     Change default mode'));
      console.log(chalk.cyan('  ctwmodel') + chalk.dim('    Show/change model'));
      console.log(chalk.cyan('  ctwhistory') + chalk.dim('  Open session manager'));
      console.log(chalk.cyan('  ctwquit') + chalk.dim('     Exit session'));
      console.log('');
      continue;
    }

    // Cost keyword
    if (lowerTask === 'ctwcost') {
      const fmtTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
      const lastCtx = session.tasks.length > 0 ? (session.tasks[session.tasks.length - 1].contextTokens || 0) : 0;
      const ctxWin = getContextWindow(session.model || readClaudeModel());
      const contextPct = lastCtx > 0 ? Math.round((lastCtx / ctxWin) * 100) : 0;
      console.log(chalk.bold('\n  Session stats\n'));
      console.log(chalk.dim('  Turns:   ') + chalk.bold(session.tasks.length));
      console.log(chalk.dim('  Est:     ') + chalk.bold(`~${fmtTokens(session.totalEstimatedTokens || 0)} tokens`));
      console.log(chalk.dim('  Context: ') + chalk.bold(`${fmtTokens(lastCtx)} / ${fmtTokens(ctxWin)} (${contextPct}%)`));
      if (session.model) {
        console.log(chalk.dim('  Model:   ') + chalk.bold(displayModelName(session.model)));
      }
      if (session.lastRateLimit && session.lastRateLimit.utilization != null) {
        const pct = Math.round(session.lastRateLimit.utilization * 100);
        const pctColor = pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green';
        const resetStr = session.lastRateLimit.resetsAt ? ` (resets ${formatResetTime(session.lastRateLimit.resetsAt)})` : '';
        console.log(chalk.dim('  Usage:   ') + chalk[pctColor].bold(`${pct}%`) + chalk.dim(resetStr));
      }
      console.log('');
      continue;
    }

    // Clear keyword
    if (lowerTask === 'ctwclear') {
      session.claudeSessionId = null;
      lastMode = null;
      responseCache.clear();
      console.log(chalk.dim('\n  Context & cache cleared. Next prompt starts fresh.\n'));
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

    // Detect follow-up: only if Claude's last response ended with a question
    const lastTask = session.tasks[session.tasks.length - 1];
    const lastResponse = lastTask?.response || '';
    const endsWithQuestion = /\?\s*$/.test(lastResponse.trim());
    const isFollowUp = session.claudeSessionId && lastMode && endsWithQuestion;

    let mode;
    if (isFollowUp) {
      mode = lastMode;
      console.log(chalk.dim(`\n  (follow-up · ${MODES[mode].name} mode)\n`));
    } else if (session.defaultMode) {
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
    lastMode = mode;

    if (!isFollowUp) {
      console.log('');
      const activeModel = session.model || readClaudeModel();
      console.log(
        chalk.dim('  Mode: ') + chalk[modeConfig.color](modeConfig.name) +
        (activeModel ? chalk.dim('  Model: ') + chalk.bold(displayModelName(activeModel)) : '')
      );
      console.log('');
    }

    // Compress the user's prompt to save tokens
    const cleanTask = compressPrompt(task);

    // For follow-ups, send raw task; for new prompts, inject short mode tag
    const prompt = isFollowUp
      ? cleanTask
      : `[${modeConfig.name.toUpperCase()}] ${modeConfig.instruction}\n${cleanTask}`;

    // Check response cache (exact match only, skip for deep mode)
    if (mode !== 'deep' && !session.claudeSessionId) {
      const cached = getCached(cleanTask, mode);
      if (cached) {
        console.log(chalk.dim('  (cached response)\n'));
        console.log(marked.parse(cached.text));
        const tokens = estimateTokens(cached.text);
        session.totalEstimatedTokens = (session.totalEstimatedTokens || 0) + tokens;
        session.tasks.push({
          task, mode, timestamp: new Date().toISOString(),
          estimatedTokens: tokens, contextTokens: 0, costUsd: 0,
          response: cached.text, fromCache: true,
        });
        writeSession(session);
        console.log('\n');
        console.log(chalk.dim('─'.repeat(50)));
        console.log(
          chalk.dim('  est. ') + chalk.bold(`~${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens`) +
          chalk.dim(' | total: ') + chalk.bold(`~${session.totalEstimatedTokens >= 1000 ? `${(session.totalEstimatedTokens / 1000).toFixed(1)}k` : session.totalEstimatedTokens} tokens`) +
          chalk.dim(' | ') + chalk.green.bold('cached')
        );
        console.log('');
        continue;
      }
    }

    let result = await runClaude(prompt, session.claudeSessionId, false, session.model, session.effort);

    if (result.sessionId) {
      session.claudeSessionId = result.sessionId;
    }

    // Custom instruction flow: user picked "Custom" in tool approval.
    // SDK finished its turn (session alive). Now ask what they want and send as follow-up.
    while (pendingCustom) {
      const ctx = pendingCustomContext;
      pendingCustom = false;
      pendingCustomContext = null;
      console.log('');
      const customInstruction = await promptInput('✎ Instead:');
      if (!customInstruction.trim()) break;
      console.log('');

      // Send as follow-up with full tool context + cwd so Claude doesn't lose track
      const toolJson = JSON.stringify(ctx.toolInput, null, 2);
      const cwd = process.cwd();
      const followUp = `You tried ${ctx.toolName}:\n${toolJson}\nWorking directory: ${cwd}\n\nRejected. Instead: ${customInstruction.trim()}\n\nUse the same tool (${ctx.toolName}), same paths. For relative paths, they're relative to ${cwd}. Do not ask for paths.`;
      result = await runClaude(followUp, session.claudeSessionId, false, session.model, session.effort);
      if (result.sessionId) {
        session.claudeSessionId = result.sessionId;
      }
    }

    // Estimate tokens from response text (original approach)
    const tokens = estimateTokens(result.text);
    session.totalEstimatedTokens = (session.totalEstimatedTokens || 0) + tokens;

    // Context window from API (input + cached tokens)
    const contextTokens = result.usage?.input_tokens || 0;
    const costUsd = result.usage?.cost_usd || 0;

    // Format token count for display
    const fmtTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

    // Store latest rate limit info on session
    if (result.rateLimit) {
      session.lastRateLimit = result.rateLimit;
    }

    session.tasks.push({
      task,
      mode,
      timestamp: new Date().toISOString(),
      estimatedTokens: tokens,
      contextTokens,
      costUsd,
      response: result.text,
    });
    writeSession(session);

    // Cache the response for future exact-match hits
    if (result.text && mode !== 'deep') {
      setCache(cleanTask, mode, result.text);
    }

    // Reset follow-up mode if response doesn't end with a question
    if (!/\?\s*$/.test((result.text || '').trim())) {
      lastMode = null;
    }

    console.log('\n');
    console.log(chalk.dim('─'.repeat(50)));

    const ctxWindow = getContextWindow(session.model || readClaudeModel());
    const contextPct = contextTokens > 0 ? Math.round((contextTokens / ctxWindow) * 100) : 0;

    // Auto-compact context when it exceeds threshold
    if (contextPct >= COMPACT_THRESHOLD * 100 && session.tasks.length >= 3) {
      console.log(chalk.dim(`  context at ${contextPct}% — compacting...`));
      const compacted = await compactContext(session, session.model, session.effort);
      if (compacted) {
        console.log(chalk.green('  ✓ context compacted') + chalk.dim(` (compaction #${session.compactions})`));
      }
    }
    console.log(
      chalk.dim('  est. ') +
      chalk.bold(`~${fmtTokens(tokens)} tokens`) +
      chalk.dim(' | total: ') +
      chalk.bold(`~${fmtTokens(session.totalEstimatedTokens)} tokens`) +
      chalk.dim(' | context: ') +
      chalk.bold(`${fmtTokens(contextTokens)} / ${fmtTokens(ctxWindow)} (${contextPct}%)`)
    );
    const displayModel = session.model || readClaudeModel();
    // Usage/rate limit line
    const rl = result.rateLimit;
    let usageLine = displayModel ? chalk.dim('  model: ') + chalk.bold(displayModelName(displayModel)) : '';
    if (rl && rl.utilization != null) {
      const pct = Math.round(rl.utilization * 100);
      const pctColor = pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green';
      const resetStr = rl.resetsAt ? ` resets ${formatResetTime(rl.resetsAt)}` : '';
      usageLine += chalk.dim((displayModel ? ' | ' : '  ') + 'usage: ') + chalk[pctColor].bold(`${pct}%`) + chalk.dim(resetStr);
    }
    usageLine += chalk.dim((usageLine ? ' | ' : '  ') + 'ctrl+c to exit');
    console.log(usageLine);

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

// Suppress unhandled abort errors from SDK
process.on('unhandledRejection', (err) => {
  if (err?.name === 'AbortError' || err?.message?.includes('aborted')) return;
  console.error(err);
  process.exit(1);
});

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log(chalk.dim('\n  Session ended.\n'));
    process.exit(0);
  }
  if (err?.name === 'AbortError' || err?.message?.includes('aborted')) return;
  console.error(err);
  process.exit(1);
});
