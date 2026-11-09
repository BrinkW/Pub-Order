# Security scan results

Raw reports from the first local run are in [2026-11-08/](2026-11-08/). They were run on `main` at `12b0d43`, before any fixes, with the same tools the CI security stage will use.

| Scan type | Tool (version) | What it scanned |
|-----------|----------------|-----------------|
| Static analysis (Python) | Bandit 1.9.4 | `backend/app`, `backend/serve.py` |
| Static analysis (Python + JS) | Semgrep 1.184.0, `p/default` ruleset (442 rules) | `backend/app`, `backend/serve.py`, `frontend/src` |
| Dependency audit (Python) | pip-audit 2.10.1 | `backend/requirements.txt`, `backend/requirements-dev.txt` |
| Dependency audit (JS) | npm audit (npm 11.6.1) | `frontend/package-lock.json` |
| Secret scan | gitleaks 8.30.1 | Whole git history, all branches (116 commits) |

## Results by severity

| Tool | Critical | High | Medium / Moderate | Low | Total |
|------|----------|------|-------------------|-----|-------|
| Bandit | 0 | 0 | 0 | 0 | 0 |
| Semgrep | 0 | 0 | 0 | 0 | 0 |
| pip-audit | 0 | 0 | 0 | 0 | 0 |
| npm audit | 0 | 2 | 4 | 0 | 6 |
| gitleaks | n/a | n/a | n/a | n/a | 4 |
| **Total** | **0** | **2** | **4** | **0** | **10** |

**Triage:** 2 true positives (fixed), 4 accepted risks (one advisory), 4 false positives.

## Triage

| # | Tool | Finding | Severity | Triage | Reason / action | Owner |
|---|------|---------|----------|--------|-----------------|-------|
| 1 | npm audit | `vite` 8.3.0–8.3.2: dev server issues (cross-origin script execution through custom middleware, files outside `server.fs.allow` served, `launch-editor` command injection) | High | True positive, **fixed** | Affects a developer's machine while `npm run dev` runs; Vite is not in the built app (`npm audit --omit=dev` finds 0). Fixed by `npm audit fix` (Vite 8.3.6), commit `35dbad8`. Lint, 222 Vitest tests, the build and the E2E journeys still pass. | Brink |
| 2 | npm audit | `undici` 7.0.0–7.30.0 (via `jsdom`): denial of service, TLS validation bypass, cache poisoning | High | True positive, **fixed** | Only used by `jsdom` in tests, never shipped. Fixed by the same `npm audit fix` (undici 7.30.2), commit `35dbad8`. | Brink |
| 3–6 | npm audit | `minimatch` 7.0.0–11.0.0 denial of service (GHSA-g3hv-75wg-m249), reported four times through `eslint`, `@eslint/config-array` and `@eslint/js` | Moderate | **Accepted risk** | Only reachable through the ESLint linter, which runs on our own source files, never on user input, and is not in the built app. The only fix npm offers (`--force`) downgrades ESLint 10 to 9. Below the CI gate (`--audit-level=high`). Revisit when ESLint ships a patched `minimatch`. | Brink |
| 7–10 | gitleaks | `generic-api-key` on `KEY = "6f1d2c34-…"` in `backend/tests/test_orders.py:14` and `frontend/src/cart.test.js:196` (2 lines, each in 2 commits) | n/a | **False positive** | A made-up UUID used as the order idempotency key in tests; it grants no access to anything. Suppressed by fingerprint with this reason in [`.gitleaksignore`](../../../.gitleaksignore), commit `15d4a22`. No key rotation needed. | Brink |

## After the fixes

| Check (as the CI gate will run it) | Result |
|------------------------------------|--------|
| `bandit -r backend/app backend/serve.py --severity-level high` | 0 issues |
| `semgrep scan --config p/default --severity ERROR --error` | 0 findings |
| `pip-audit -r backend/requirements.txt` | No known vulnerabilities |
| `npm audit --audit-level=high` | Passes (4 Moderate remain, accepted above) |
| `gitleaks git` (whole history) | No leaks found |

## Notes

- The gitleaks report's `Secret` and `Email` fields are redacted in the committed copy.
- Semgrep found nothing, so its text report was empty; the JSON report records the scan (46 files, 0 results, 0 errors).
