# AGENTS.md

This file describes how Codex (and other agents) should work in this repo.
Keep it short, specific, and up to date.

## Purpose
- Explain what this project is and who it’s for.
- List the agent’s primary responsibilities in this repo.

## Working Agreements
- Preferred tools (frameworks, libraries) and coding conventions.
- Required file patterns or directories to touch/avoid.
- Any do/don’t rules (security, performance, UX, style).
- PowerShell: when using `Get-Content`, always include `-Encoding utf8` to avoid garbled text.
- Encoding: all text files must be UTF-8 **without BOM**. Remove any existing BOMs and write new files with UTF-8 (no BOM).

## Project Context
- Repo structure overview (1–3 bullets).
- Key entry points (files and folders).
- Local environment assumptions (Node version, package manager, etc.).

## Data & Integrations
- External services (e.g., Supabase, APIs) and what they’re used for.
- Secrets handling and config locations.

## Testing & Validation
- How to run tests or builds.
- Expected commands before PRs.

## Release / Deploy
- Build output location.
- Hosting / deployment steps (if any).

## Contact / Ownership
- Who to ask for clarifications.
- Links or internal docs (if any).
