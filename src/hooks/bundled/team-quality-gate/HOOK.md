---
name: team-quality-gate
description: Validates task completion quality before marking tasks done. Checks that task artifacts exist and task list consistency is maintained.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "events": ["tool_result_persist"],
        "always": false,
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Team Quality Gate

This hook runs when `team_task_complete` is called. It validates:

1. The task exists and is in a completable state
2. Task list consistency (no orphaned dependencies)
3. The task was assigned before completion

If validation fails, the hook provides feedback explaining what needs to be fixed.

## Configuration

Enable this hook in your team template:

```json
{
  "hooks": {
    "TaskCompleted": "team-quality-gate"
  }
}
```

## Behavior

- **Exit 0**: Task completion is valid
- **Exit 2**: Task completion failed validation; feedback is provided
