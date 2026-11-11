# Pub-Order

[![Tests](https://github.com/hamayunrz/Pub-Order/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/hamayunrz/Pub-Order/actions/workflows/tests.yml)

Pub-Order is a web application designed to make ordering food from Vanderbilt's Pub faster and more convenient for students.

The goal of the project is to allow students to view available menu items, place an order, and track their pickup status without having to wait in line.

## Features

- Student login and authentication
- View current menu items
- See Pub dietary-preference and allergen markers on each menu item
- See the latest crowd level reported by Pub staff
- Add items to a cart
- Place food orders
- View order status
- Estimated wait times
- Simple interface designed for Vanderbilt students
- Staff controls for Low, Moderate, or Busy crowd levels

Menu markers were verified against Vanderbilt NetNutrition for The Pub at Overcup Oak on November 11, 2026. Dining data can change; students with dietary restrictions should confirm current information with Campus Dining staff.

## Tech Stack

### Frontend
- React (Vite)

### Backend
- FastAPI
- Python

### Database and Authentication
- Supabase
- Supabase Auth

## Project Structure

```text
frontend/       React app (Vite)
  src/          App entry point and components
backend/        FastAPI app
  app/          Python application package
docs/diagrams/  UML diagrams
```

## Run locally

First, copy `.env.example` to `.env` in the repo root and fill in the Supabase URL and anon key.

Before using the app, apply the migrations in `supabase/migrations/` once, in filename order, to the intended Supabase project: `202610120001_menu_items.sql` (the menu) and then `202610180001_orders.sql` (orders). See [Hamayun’s US1/US2 walkthrough](docs/hamayun-us1-us2.md) for setup, the meal-swipe rules, API contract, tests, and the US3 handoff.

Kitchen staff can email a student the current status of an order. Apply the order-email migration, then set `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` in the backend environment. The sender must be verified by Resend; the API key remains server-side and must never be committed.

**Orders API (US3).** Signed-in students place orders with `POST /api/orders` (the checkout review body plus an `idempotencyKey`), and read their own orders with `GET /api/orders` and `GET /api/orders/{id}`. Orders are saved only through the `place_order` database function, which re-checks the meal and stores the order and its items together; retrying with the same key returns the same order. New orders start as `Received`; the status column also allows `Preparing`, `Ready` and `Collected` for US5 and US6.

Frontend (Node.js 22.12+):

```sh
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Backend (Python 3.10+), in a separate terminal. It must run on port 8001, because the frontend forwards `/api` requests there.

```sh
cd backend
python -m venv .venv            # macOS/Linux: python3 -m venv .venv
.venv\Scripts\Activate.ps1      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

You only need to create the venv and run `pip install` the first time. After that, activate the venv and start `uvicorn`.

If Windows says running scripts is disabled when you activate the venv, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

The frontend opens on the login page. The backend's API docs (Swagger) are at http://127.0.0.1:8001/docs.

## Running tests

Unit tests replace Supabase with a fake, so they don't need a `.env` file or a network connection.

Backend, from `backend/` with the virtual environment active:

```sh
pip install -r requirements-dev.txt       # pinned versions
ruff check .                              # lint
mypy                                      # type check
pytest -m "not integration"               # unit tests
pytest -m integration                     # integration tests (need local Supabase, below)
pytest --cov=app --cov-branch --cov-report=term-missing
```

Frontend, from `frontend/`:

```sh
npm run lint              # ESLint
npm run test:unit         # unit and component tests
npm run test:integration  # *.integration.test.jsx
npm run coverage          # all Vitest tests with branch coverage (fails below 70%)
npm run test:cart         # cart logic tests only
npm run build             # production build
```

End-to-end (Playwright), from `frontend/`. The first time, download the browser with `npx playwright install chromium`.

```sh
npm run test:e2e    # starts the dev server itself (and the backend when a test user is set)
```

**Integration tests use a throwaway local Supabase**, never the team's hosted project. In CI, [start-local-supabase.sh](.github/scripts/start-local-supabase.sh) starts it in Docker, applies `supabase/migrations`, and creates a test user. To run these tests yourself, install Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development), run `supabase start` from the repo root, and set `SUPABASE_URL`, `SUPABASE_KEY`, `PUB_ORDER_TEST_EMAIL`, `PUB_ORDER_TEST_PASSWORD` and `PUB_ORDER_TEST_SERVICE_KEY` to the local values. Tests that change data refuse to run unless `SUPABASE_URL` is `127.0.0.1` or `localhost`. The test variables deliberately don't start with `SUPABASE_`, because the frontend sends every `SUPABASE_*` value to the browser.

**CI/CD.** GitHub Actions ([tests.yml](.github/workflows/tests.yml)) runs on every pull request and every push to `main`:

- **backend** and **frontend:** install → lint → type check (backend only) → unit tests → integration tests → coverage report, stopping at the first failure. The backend job also checks the menu migration and its permissions.
- **security:** in parallel with the test jobs, scans for secrets in the whole git history (gitleaks), runs static analysis (Bandit for Python, Semgrep for Python and JavaScript) and audits dependencies (`pip-audit`, `npm audit --audit-level=high`). Every scan runs even if an earlier one fails, and any High finding fails the check. Scanner versions are pinned in `backend/requirements-security.txt`; known false positives are listed with reasons in `.gitleaksignore`. Results and triage: [docs/security/scans/](docs/security/scans/README.md).
- **e2e:** browser tests against the real stack after both pass.
- **deliver:** after the test jobs and the security job pass, on every push to `main`, packages a versioned, runnable build (`pub-order-0.3.<run>-<commit>.zip`, run with `uvicorn serve:app`) as a workflow artifact, and smoke-tests the Docker image used for staging (see [Deploy](#deploy-staging)). Pushing a `sprint3` tag also publishes it as a GitHub Release.

Packaged builds read the Supabase URL and public anon/publishable key from the root `.env` at server startup and expose those public values through `/config.js`. No GitHub build secrets or frontend rebuild are needed. Never use a service-role key as `SUPABASE_KEY`. Apply the included `migrations/` SQL files in filename order to the configured project before use.

The frontend job also checks that the production build succeeds. See [docs/testing.md](docs/testing.md) for a list of every test and what it checks.

For trying the API by hand, use the Swagger UI at `/docs` on the running backend.

## Deploy (staging)

The staging site runs on [Render](https://render.com) from the root [Dockerfile](Dockerfile), which builds the frontend and serves it with the API from one process (`backend/serve.py`), over HTTPS. [render.yaml](render.yaml) tells Render to deploy `main` only after that commit's GitHub checks pass, so nothing is deployed by hand and a red pipeline blocks the deploy. The free instance sleeps after 15 minutes idle, so the first visit after a break takes about a minute.

To run the same build locally (Docker needed), with the root `.env` filled in:

```sh
docker compose up --build    # http://localhost:8000
```

One-time setup:

1. In Render, choose **New → Blueprint**, pick this repository, and enter `SUPABASE_URL` and `SUPABASE_KEY` when asked. Use the public anon/publishable key, never the service-role key. For the kitchen's **Email student** button, also enter `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL`; leave them blank to run without email. Render only asks for these when the Blueprint is created; change them later under the service's **Environment** tab.
2. In the hosted Supabase project, under **Authentication → URL Configuration**, set **Site URL** to the Render URL and add it to **Redirect URLs** (keep `http://localhost:5173` for development). Otherwise sign-up emails link to localhost.
3. Make sure every file in `supabase/migrations/` has been applied to the hosted project, in filename order.
4. To use the kitchen view, set an account's `role` to `kitchen` in the `profiles` table.

The Supabase keys live only in Render's dashboard. GitHub Actions never sees them, because CI tests against a throwaway local Supabase.

## Team

This project is being developed as a group project at Vanderbilt University.

## Status

Currently in development.
