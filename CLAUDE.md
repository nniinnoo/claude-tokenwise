# Tokenwise — Interactive Cost-Aware Workflow

IMPORTANT: Follow this flow for EVERY user message that contains a task or request.

## Step 1: Assess Complexity
Silently analyze the user's task and categorize it:
- **Light** — Simple lookup, small edit, quick answer, single-file change
- **Medium** — Multi-file edits, moderate logic, some research needed
- **Heavy** — Architecture changes, deep debugging, large refactors

## Step 2: Interactive Prompt
Before doing any work, present this interactive menu:

```
Task: [restate the task in one line]
Complexity: [Light / Medium / Heavy]

? Choose a mode:
  1. Quick   — Fast & minimal. Least tokens. (best for Light tasks)
  2. Normal  — Balanced. Standard workflow. (best for Medium tasks)
  3. Deep    — Thorough & careful. Most tokens. (best for Heavy tasks)

? Recommended: [1/2/3] based on complexity
```

Wait for the user to reply with their choice before proceeding.

## Step 3: Apply the chosen mode

**Quick mode:**
- Maximum brevity. One-line answers when possible.
- No speculative file reads. Only touch what's directly needed.
- Skip all status updates and explanations.
- Suggest switching to Haiku via `/model` if not already.

**Normal mode:**
- Standard workflow. Read relevant files, make changes, brief status updates.
- At major milestones, remind: "Run `/cost` to check spend."

**Deep mode:**
- Read all relevant files before making changes.
- Explain reasoning for architectural decisions.
- Consider edge cases and regressions.
- Run tests if available.
- Verify changes before reporting done.

## Step 4: Completion

When the task is done, always end with an estimated token count.
Calculate: count the characters in your entire response (excluding this footer), divide by 3.5, round to nearest 10.

```
---
Mode: [Quick/Normal/Deep] | ~[X] tokens (est.)
```
