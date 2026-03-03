# AGENTS.md

This file defines how Codex (and other agents) should work in this repository.

## Purpose
- Build and maintain a trading system with `backend`, `frontend`, and `train` domains.
- Keep training/backtest/storage logic inside `train` and avoid leaking it back into `backend`.

## Working Agreements
- PowerShell: when using `Get-Content`, always include `-Encoding utf8`.
- Encoding: all text files must be UTF-8 without BOM.
- Prefer small, focused refactors; keep backward-compatible script entry files when possible.
- Do not re-introduce root-level Node package workflow (`/package.json` was removed intentionally).

## Project Context
- `backend/`: API server, DB schema/init scripts, runtime backend services only.
- `frontend/`: Vite app.
- `train/`: strategy training/backtest/validation/query/save scripts and services.

Key train entry points:
- `train/scripts/run-training.js` (config-driven training runner)
- `train/scripts/run-validation.js` (config-driven validation runner)
- `train/backtest-training-service.js`
- `train/strategy-validation-service.js`
- `train/configs/training/*.json`
- `train/configs/validation/*.json`

## Data & Integrations
- MySQL is the primary data store.
- Train DB config: `train/config/database.js`.
- Env files:
  - `train/.env` (preferred for train local/container runs)
  - `backend/.env` (legacy fallback)

## Testing & Validation
- Use Docker Compose as the primary execution path.
- Start base services:
  - `docker compose up -d mysql api frontend adminer`
- Run train commands with one-off container:
  - `docker compose run --rm train npm run backtest:2025`
  - `docker compose run --rm train npm run backtest:2024 -- -- --limit 500 --types rsi_only`
  - `docker compose run --rm train npm run validate:2025`
  - `docker compose run --rm train npm run group:run -- -- --group 1 --groups 10`

## Release / Deploy
- Local dev stack is orchestrated by `docker-compose.yml`.
- Keep service names/network compatibility stable (`mysql`, `api`, `frontend`, `adminer`, `train`).

## Do / Don’t
- Do keep training parameter changes in JSON config files, not hardcoded in many scripts.
- Do extract duplicated script logic into reusable services/utilities.
- Don’t add new duplicated year-specific scripts if config-driven runner can handle it.
- Don’t couple `train` to `backend/config/database`.

## Contact / Ownership
- If ownership is unclear, ask the repository maintainer in the current task thread and update this file.
