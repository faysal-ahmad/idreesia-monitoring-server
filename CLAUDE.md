<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## graphify

This project has a knowledge graph at the **workspace root** `graphify-out/` (i.e. `<repo>/graphify-out/`, next to `packages/security-server/`, `packages/security-server-ui/`, etc.) with god nodes, community structure, and cross-file relationships.

Rules:

- Always use and update **only** the workspace-root `graphify-out/`. Run all `graphify` commands from the repository root (the directory that contains `CLAUDE.md` and the root `graphify-out/`), never from `packages/security-server/`, `packages/security-server-ui/`, or other subpackages.
- Never create, write, or refresh a nested `graphify-out/` under `packages/security-server/`, `packages/security-server-ui/`, or any other subdirectory — that duplicates the monorepo graph and fragments cross-package context. If a nested copy appears, delete it and continue using the root graph.
- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists at the repo root. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If `graphify-out/wiki/index.md` exists at the repo root, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, from the **repository root** run `graphify update .` to keep the root graph current (AST-only, no API cost).
- `graphify-out/` is gitignored in this repo (unlike idreesia-erp, which commits it) — never `git add` it, even after running `graphify update`.
