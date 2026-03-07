#!/usr/bin/env node

import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { readSession, writeSession, estimateTokens } from '../lib/tracker.js';
import { spawn } from 'child_process';

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
];

function runClaude(prompt) {
  return new Promise((resolve) => {
    const claude = spawn('claude', ['-p', prompt], {
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    let output = '';

    claude.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    claude.on('close', () => resolve(output));
  });
}

async function promptLoop() {
  // Show banner
  console.log(chalk.bold('\n  cw') + chalk.dim(' — cost-aware Claude Code'));
  console.log(chalk.dim('  ctrl+c to exit\n'));

  const session = readSession();

  while (true) {
    // Ask for task
    const task = await input({
      message: 'Prompt:',
      theme: { prefix: chalk.cyan('?') },
    });

    if (!task.trim()) continue;

    // Pick mode
    const mode = await select({
      message: 'Mode:',
      choices: MODE_CHOICES,
      theme: { prefix: chalk.cyan('?') },
    });

    const modeConfig = MODES[mode];

    // Show summary
    console.log('');
    console.log(chalk.dim('  Mode: ') + chalk[modeConfig.color](modeConfig.name));
    console.log('');

    // Build prompt and run
    const prompt = `[MODE: ${modeConfig.name.toUpperCase()}] ${modeConfig.instruction}\n\nTask: ${task}`;
    const output = await runClaude(prompt);

    // Estimate tokens
    const tokens = estimateTokens(output);
    session.totalEstimatedTokens = (session.totalEstimatedTokens || 0) + tokens;
    session.tasks.push({
      task,
      mode,
      timestamp: new Date().toISOString(),
      estimatedTokens: tokens,
    });
    writeSession(session);

    // Show token footer
    console.log('');
    console.log(chalk.dim('─'.repeat(50)));
    console.log(
      chalk.dim('  est. ') +
      chalk.bold(`~${tokens.toLocaleString()} tokens`) +
      chalk.dim(' | total: ') +
      chalk.bold(`~${session.totalEstimatedTokens.toLocaleString()} tokens`)
    );
    console.log('');
  }
}

promptLoop().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log(chalk.dim('\n  Session ended.\n'));
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
