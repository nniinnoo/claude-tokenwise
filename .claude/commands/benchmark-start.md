# Benchmark Start — Record Baseline

Start tracking token usage for the current task.

## Steps:

1. Ask the user:
   - **Task description**: "What task are you about to do? (brief description)"
   - **Mode**: "Which mode are you using? (light / normal / deep / none)"

2. Ask the user to run `/cost` and paste the output here.

3. Parse the cost output. Extract:
   - Total tokens used so far
   - Total cost so far
   - (If user can't paste, ask them to note the numbers manually)

4. Read the benchmark log file at `.claude/benchmarks.json`. If it doesn't exist, initialize it as `{"benchmarks": []}`.

5. Create a new benchmark entry and append it:
   ```json
   {
     "id": "<incremented number>",
     "task": "<user's description>",
     "mode": "<mode>",
     "started_at": "<current datetime>",
     "start_cost": "<cost from /cost>",
     "start_tokens": "<tokens from /cost>",
     "end_cost": null,
     "end_tokens": null,
     "delta_cost": null,
     "delta_tokens": null,
     "status": "in_progress"
   }
   ```

6. Save the updated log file.

7. Confirm: "Benchmark #[id] started. Run your task, then use `/benchmark-end` when done."
