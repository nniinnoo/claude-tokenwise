# Budget Check — Cost-Aware Workflow

Help the user manage their token spend.

## Steps:

1. Remind the user to run `/cost` now to see current session spend.

2. Ask: "What's your budget comfort level for this task?"
   - **Minimal** — I'll work in light mode, bare minimum actions
   - **Normal** — Standard workflow, balanced approach
   - **Unlimited** — Full deep mode, no token concerns

3. Based on their answer, apply the corresponding mode:
   - Minimal → Follow light mode rules
   - Normal → Standard behavior, but remind to check `/cost` at milestones
   - Unlimited → Follow deep mode rules

4. At natural milestones (after major changes, before starting new subtasks), say:
   "Milestone reached. Run `/cost` to check spend before I continue."
