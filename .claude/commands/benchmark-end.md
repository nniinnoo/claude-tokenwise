# Benchmark End — Record Final Cost

Finish tracking token usage for the current task.

## Steps:

1. Read the benchmark log at `.claude/benchmarks.json`.

2. Find the most recent benchmark with `"status": "in_progress"`. If none found, say: "No active benchmark. Run `/benchmark-start` first."

3. Ask the user to run `/cost` and paste the output here.

4. Parse the cost output. Extract:
   - Total tokens used so far
   - Total cost so far

5. Calculate deltas:
   - `delta_tokens` = end_tokens - start_tokens
   - `delta_cost` = end_cost - start_cost

6. Update the benchmark entry:
   ```json
   {
     "end_cost": "<cost>",
     "end_tokens": "<tokens>",
     "delta_cost": "<calculated>",
     "delta_tokens": "<calculated>",
     "status": "completed"
   }
   ```

7. Save the updated log file.

8. Show the result:
   ```
   Benchmark #[id] complete
   Task: [description]
   Mode: [mode]
   Tokens used: [delta_tokens]
   Cost: $[delta_cost]
   ```

9. If there are previous completed benchmarks for comparison, show:
   ```
   Comparison with previous benchmarks:
   #[id] | [task] | [mode] | [tokens] | $[cost]
   #[id] | [task] | [mode] | [tokens] | $[cost]  <-- current
   ```
