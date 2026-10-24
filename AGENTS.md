# Agent Directions

## Orca agents

- **Prefer Orca-managed agents whenever delegation is useful or a skill calls
  for another agent.** Use Orca for research, implementation, independent
  critique, review, testing, and handoffs when available.
- Read [the repository Orca guide](.agents/skills/orca-agents/SKILL.md) before
  launching agents or creating worktrees. It covers CLI discovery, managed
  workspaces, supervised work, and explicit fallbacks.
- Keep routine work with the current agent. Additional agents must have bounded
  responsibilities and must preserve the task's authority and safety limits.
- Do not silently substitute native subagents, raw agent CLI processes, or
  unmanaged worktrees when Orca can do the job.
