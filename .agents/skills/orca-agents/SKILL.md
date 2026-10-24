---
name: orca-agents
description: Use Orca-managed agents for delegated research, implementation, independent review, testing, and handoffs in this repository. Use when another agent or isolated workspace is needed; keep routine work with the current agent.
---

# Orca Agents

**Orca is the preferred agent execution and worktree manager.** Use it whenever
delegation is useful or another skill calls for a worker, researcher, critic,
reviewer, or tester. An Orca agent is a Codex, Claude, or other configured agent
launched and tracked by Orca; it is not a separate model provider.

## Discover the current interface

Resolve `orca` with `command -v orca`. On Forge, also check `forge-orca`;
the installed wrapper is `/home/jed/code/.forge-runtime/orca/bin/orca`.
Use one resolved executable consistently. The examples below use `orca`;
substitute the resolved executable when it has a different name or path.

```bash
orca status --json
orca skills get orca-cli
orca repo list --json
orca worktree list --repo path:<absolute-repository-path> --json
```

Read the installed, version-matched guide instead of guessing commands from
memory. Confirm the target host, repository, and workspace. Reuse an intentional
task workspace rather than creating duplicates. Do not start, update, pair, or
reconfigure a runtime merely to satisfy this preference.

## Pick the smallest useful execution

- Routine edits, commands, and checks stay with the current agent. Orca
  preference does not require a second agent for every task.
- Delegate separable implementation or research and independent reviews through
  Orca rather than native subagent tools or raw `codex`/`claude` processes.
- Give every agent a bounded brief: goal, exact repo/workspace and base,
  permitted files, read-only or edit authority, constraints, acceptance checks,
  and expected evidence. Preserve repository Brain scope and secret handling.
- Honor the user's requested agent, model, effort, and execution host. Otherwise
  use the configured agent defaults. Do not add a mandatory reviewer roster or
  repeat debates beyond the active delivery skill's convergence budget.

## Workspaces and ownership handoffs

Use `orca worktree create` for new isolated workspaces. Select the base required
by the task and repository; Orca lineage does not choose the Git base. Use
`--base-branch <verified-ref-or-sha>` when a specific base matters. Use
`--setup skip` when setup hooks would exceed this task's authority. Copy the
returned workspace ID, path, and branch; do not invent them. If explicitly
requested dirty state must be transferred, finish and verify the transfer
before launching an editing agent.

For a fresh agent in an existing, verified workspace:

```bash
orca agent launch --agent codex --worktree path:<absolute-task-workspace> --prompt '<bounded task brief>' --json
```

For a full ownership handoff, follow `orca-cli`: deliver the prompt, verify the
launch receipt, report the returned workspace and agent handle, then stop.
Do not create coordinator tracking or wait for completion unless supervision
was requested. Use the user's agent selection in place of `codex` when given.

## Supervised parallel work

When the task calls for supervision, monitoring, waiting for agent results,
or coordinating dependent tasks, load the current contract first:

```bash
orca skills get orchestration
```

Use its Run/Task/Dispatch and supervised worker workflow. Keep writes disjoint
or give editors separate managed worktrees; reviewers remain read-only. Launch
the useful independent wave before waiting. Inspect evidence and completion
receipts, answer blocking questions, and settle/release workers according to
that guide. A timeout, quiet terminal, or successful prompt enqueue is not
proof of completion. Do not duplicate an in-flight assignment locally.

## Explicit fallback and authority

If the executable, runtime, access, or needed capability is unavailable, state
the specific failure and the proposed fallback before proceeding. Continue
with the current agent or an otherwise authorized native mechanism when that
can meet the task. If the user requires Orca provenance or a particular remote
host, report the limitation instead of substituting another execution path.

After an uncertain launch, inspect or replay the original operation using the
installed guide; never launch a replacement just because the reply was lost.
Do not treat missing connectivity as proof a worker stopped. Agent delegation
does not authorize deployment, publishing, external messages, trading,
credential changes, production writes, or expanded task scope. Preserve those
boundaries in every brief. Handoff evidence names the Orca workspace/agent or
dispatch, verification performed, remaining risk, and any fallback used.
