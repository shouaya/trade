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
- `train/`: strategy training/backtest/validation/query/save logic and runtime services.

Key train entry points:
- `train/src/scripts/train.ts` (shared train / validate entry)
- `train/src/scripts/init-db.ts`
- `train/src/scripts/train-run-worker.ts`
- `train/src/scripts/router-validate.ts`
- `train/scripts/generate-top3-validation-configs.js` (still used by the train worker / operator flow)
- `train/configs/training/*.json`
- `train/configs/validation/*.json`

## Data & Integrations
- MySQL is the primary data store.
- Shared DB helpers/schema: `database/`
- Train DB config entry: `train/src/configs/database.ts`
- Env files:
  - `train/.env` (preferred for train local/container runs)
  - `backend/.env` (legacy fallback)

## Testing & Validation
- Use Docker Compose as the primary execution path.
- Start base services:
  - `docker compose up -d mysql api frontend adminer`
- Run train commands with one-off container:
  - `docker compose run --rm train sh -lc "npm install && npm run build && npm run train -- configs/training/<config>.json"`
  - `docker compose run --rm train sh -lc "npm install && npm run build && npm run validate -- configs/validation/<config>.json"`
  - `docker compose run --rm train sh -lc "npm install && npm run build && npm run init-db"`
  - `docker compose run --rm train sh -lc "npm install && node scripts/generate-top3-validation-configs.js ..."`

## Release / Deploy
- Local dev stack is orchestrated by `docker-compose.yml`.
- Keep service names/network compatibility stable (`mysql`, `api`, `frontend`, `adminer`, `train`).

## Do / Don’t
- Do keep training parameter changes in JSON config files, not hardcoded in many scripts.
- Do extract duplicated runtime logic into `train/src/services` or shared helpers.
- Do treat `train/src/scripts/*` as the formal train runtime entry layer.
- Don’t add new duplicated year-specific scripts if the config-driven runner can handle it.
- Don’t re-introduce research / exploratory script sprawl under `train/scripts/`.
- Don’t couple `train` to `backend/config/database`.

## Contact / Ownership
- If ownership is unclear, ask the repository maintainer in the current task thread and update this file.
