# WFP PRISM Alerting node

This project is part the World Food Programme's [PRISM project](https://innovation.wfp.org/project/prism).
It provides a service called `alerting-node` able to send emails when alerts are triggered.

It comes with a database which persists alerts related data. The database is provided via a docker container. See the service `alerting-db` in the file [docker-compose.yml](./docker-compose.yml)

There is a unique service running for all country specific frontends.

## Database schema and migrations

The alerting stack uses the same PostgreSQL database as the PRISM API for `alert`, `kobo_users`, and `anticipatory_action_alerts`. **Python/Alembic under `api/alembic/` is the sole owner of schema migrations** for this database. Change SQLModel in `api/prism_app/database/`, add an Alembic revision under `api/alembic/versions/`, and run `alembic upgrade head` with `PRISM_ALERTS_DATABASE_URL` (see `api/README.md`).

## Functionalities

- `anticipatory action storm` alerts
  - Checks latest storm forecast reports, decides triggers, sends alert emails when necessary.
- `anticipatory action flood` alerts
  - Loads **all** `anticipatory_action_alerts` rows with `type = flood`. Each row’s `metadata.floodDatesUrl` must point at `dates.json`. Evaluates `trigger_status`, sends email when thresholds hit, map screenshot uses that row’s `prism_url`.

## Setup - anticipatory action alerts

- Alerts are triggered by a cron job running within the `alerting-node` process.
- Run `docker compose up` to launch the `alerting-node` and `alerting-db` processes.
- **Storm:** worker queries alerts by country + type (single-country env constant today).
- **Flood:** one cron run processes **every** flood row; each row carries its own data URL and recipients in the database (see `metadata` below).
- After the DB schema exists, seed local data from the **API** (same repo area that owns migrations)—see **Local dev seed data** in [`api/README.md`](../api/README.md): `poetry run python scripts/seed_alerts_db.py` from `api/`. Connection vars are `PRISM_ALERTS_DATABASE_URL` or `POSTGRES_*` in `api/.env`; for host access to `alerting-db`, use port `54321` as in [`.env.example`](./.env.example).

- **country**: Display / matching string for the alert (case-insensitive for storm lookups via `ILIKE`).
- **emails**: Recipients.
- **prism_url**: Base URL for screenshot + deep link (must match that deployment’s frontend).
- **type**: Hazard type enum: `storm` | `flood` | `drought`.
- **metadata** (JSONB, optional): Hazard-specific config. For **`flood`**, set at least:
  - **`floodDatesUrl`**: Full URL to `dates.json` (same layout as the PRISM frontend `anticipatoryActionFloodUrl`).
  - Optional email/chart copy overrides: `countryDisplayName`, `forecastLeadDaysMin`, `forecastLeadDaysMax`, `forecastAttributionLine`, `disclaimerAuthorityHtml`, `disclaimerAuthorityPlain`, `mapAltCountry`.

The `type` column is a PostgreSQL ENUM (`anticipatory_action_alerts_type_enum`) defined by the Alembic baseline under `api/alembic/versions/`.

### Optional: threshold `alert` rows + `kobo_users` (local testing)

For [Starlette Admin](https://github.com/jowilf/starlette-admin) or API smoke tests, use the same seed step as above: from `api/`, run `poetry run python scripts/seed_alerts_db.py`. That executes [`api/scripts/seed_local_alerts_dev.sql`](../api/scripts/seed_local_alerts_dev.sql), which loads sample `alert` and `kobo_users` rows (and the Mozambique AA rows, including flood `metadata`) in one shot. Re-running is safe: see comments at the top of that SQL file.

- **User password:** with `salt = 'false'`, the PRISM API validates this row using a **plain-text** password match ([`prism_app/auth.py`](../api/prism_app/auth.py))—use HTTP Basic `local_dev_user` / `localdev` when auth is enabled.

### Shared worker runner

**Storm** alerts use `src/aa-common/runner.ts` for DB lookup by country + type, shared `prepare`, per-alert email build, send, and `last_states` updates.

**Flood** alerts use the same DB helpers (`findAllAnticipatoryActionAlertsByType`, `updateAnticipatoryActionAlert`) but **do not** call `runAAWorker`: each flood row supplies its own `metadata.floodDatesUrl`, so the worker loops rows and fetches `dates.json` per row.

Hazard-specific logic lives in:
- Storm: `src/aa-storm-alert/alert.ts` and `src/aa-storm-alert/worker.ts`
- Flood: `src/aa-flood-alert/alert.ts` and `src/aa-flood-alert/worker.ts`

## Test sending emails

Follow these steps to test the email sending functionality for storm alerts:

- Run `docker compose up` to launch the `alerting-node` and `alerting-db` processes
- Make sure to have at least one entry in the database (See the Setup section for more details)
- Use this command to send test emails :

```bash
# Storm
sudo docker compose run --entrypoint "yarn aa-storm-alert-worker --testEmail='email1@example.com,email2@example.com'" alerting-node

# Flood
sudo docker compose run --entrypoint "yarn aa-flood-alert-worker --testEmail='email1@example.com,email2@example.com'" alerting-node
```
- The provided emails replace the DB-configured recipients for test runs.

### Ethereal (fake SMTP, no credentials)

If **`PRISM_ALERTS_EMAIL_USER`** and **`PRISM_ALERTS_EMAIL_PASSWORD`** are both unset or empty, [`src/utils/email.ts`](./src/utils/email.ts) uses Nodemailer’s [Ethereal](https://ethereal.email) test inbox: it creates a disposable SMTP account, sends through `smtp.ethereal.email`, and logs a **preview URL** (`Preview URL: …`) you can open in a browser to read the message and attachments.

This is independent of **`--testEmail`**: you can keep using test addresses in the command; Ethereal still delivers to its fake SMTP and you inspect the result via the preview URL (those addresses are not a real inbox).

1. Ensure real SMTP env vars are not set (or remove them from `.env` / compose for local runs).
2. Run a worker that sends mail (commands above, or threshold `alert-worker` if your DB triggers a send).
3. Copy the logged preview link from the container or terminal output.

Each run may use a new Ethereal account. To reuse one inbox, configure Ethereal’s SMTP user/password yourself via `PRISM_ALERTS_EMAIL_USER`, `PRISM_ALERTS_EMAIL_PASSWORD`, and `PRISM_ALERTS_EMAIL_HOST` (e.g. `smtp.ethereal.email`).

### Flood data source
- Each flood alert row provides **`metadata.floodDatesUrl`** (must end with `dates.json`; CSV siblings resolve relative to that URL, same as the frontend).
- Mozambique installs are **backfilled** on migration with the historical public `moz/dates.json` URL when `metadata` was null.
- Email triggers when `trigger_status` is one of: `bankfull`, `moderate`, `severe`.
- Duplicate suppression uses `last_states.flood_alert_<id>` (legacy key `moz_flood` is still read once for migration).

## CI and release checks (shared alerts database)

GitHub Actions job **`alerts_db_alembic_and_alerting`** (in [`.github/workflows/api.yml`](../.github/workflows/api.yml)) starts an ephemeral Postgres, runs `alembic upgrade head` from `api/`, then:

1. **`yarn check-alerts-db-contract`** — Validates tables/columns/types the Node workers query still match the migrated schema (`src/ci/check-alerts-db-contract.ts`). Requires `PRISM_ALERTS_DATABASE_URL`.
2. **`yarn smoke-alerts-db-pool`** — Runs real `pg` queries used by threshold and AA workers (empty tables OK; `src/ci/smoke-alerts-db-pool.ts`).
3. **`yarn smoke-alerting-workers`** — Runs `runAlertWorker()` plus AA storm queries and flood `findAllAnticipatoryActionAlertsByType('flood')` (`src/ci/smoke-alerting-workers.ts`; safe when there are no active alerts).

The same job then runs **`pytest`** on `test_api.py`, `test_alerting.py`, and **`test_alerts_db_integration.py`** so the API, `/stats` alerting fixture, admin list routes, and Alembic metadata align with that database. See [api/README.md](../api/README.md) (**Alerts database (CI integration + local)**).

**Before or right after the first production `alembic upgrade` on the shared alerts DB**, also smoke manually: full `alert-worker`, one AA worker **without** `--testEmail` (so the pool hits Postgres), and read-only Starlette Admin on `alert` / `kobo_users` / `anticipatory_action_alerts`.

## Server crons
Alert workers are running as crons on the server. Edit with: `crontab -e`
Crontab examples :
```
0 * * * *  ~/prism-app/alerting/crons/cron_aa_storm_alert_run.sh
5 * * * *  ~/prism-app/alerting/crons/cron_aa_flood_alert_run.sh
0 1 * * *  ~/prism-app/alerting/crons/cron_alert_run.sh
```
