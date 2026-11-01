# Tests

This page lists every automated test in the project: where it is and what it checks. For how to run the tests, see [Running tests](../README.md#running-tests) in the README.

**Totals:**
- **Backend (pytest):** 109 tests: 81 unit, 28 integration
- **Frontend (Vitest + React Testing Library):** 206 tests: 188 unit and component, 18 integration
- **E2E (Playwright):** 11 tests
- **Database (SQL):** two migration check scripts (menu and orders)

Tests marked "×N" run once per input listed.

| Level | What it means here | Where |
|---|---|---|
| **Unit and component** | One function or component, with Supabase and `fetch` faked | `backend/tests/`, `frontend/src/*.test.js(x)` |
| **Integration** | Real pieces working together. Backend integration tests go through the API, real auth and a **real database** (a throwaway local Supabase); frontend integration tests run the real components together with only the outside services faked | `backend/tests/integration/`, `frontend/src/*.integration.test.jsx` |
| **Database** | The menu migration's data and permissions, checked directly in the local test database | `supabase/tests/menu_items.sql`, `supabase/tests/orders.sql` |
| **E2E** | The real app in a real browser (Chromium). Most journeys answer `/api/menu` with the seed menu; the sign-in and full-stack journeys use the real backend and database | `frontend/e2e/` |

**Integration tests never touch the team's hosted Supabase.** CI starts a throwaway local Supabase with [start-local-supabase.sh](../.github/scripts/start-local-supabase.sh): Postgres, Auth and the REST API in Docker, with `supabase/migrations` applied and a test user created. Without it, the integration tests and the real-backend E2E journeys are skipped locally. In CI, a skipped one counts as a failure (`PUB_ORDER_REQUIRE_INTEGRATION=1`), so a broken setup can't pass quietly.

GitHub Actions ([.github/workflows/tests.yml](../.github/workflows/tests.yml)) runs on every pull request and every push to `main`. The **backend** and **frontend** jobs run install → lint → type check → unit tests → integration tests → coverage report, stopping at the first failure. Coverage below 70% of branches fails the job. **e2e** runs after both pass, and **deliver** packages a versioned build on every push to `main`.

## Seam map

| Seam | Tested by | Real or faked |
|---|---|---|
| Browser → Vite proxy → FastAPI | `vite-config.test.js` (contract), full-stack and sign-in E2E | Real in E2E |
| Frontend → Supabase Auth (sign-in) | `sign-in.spec.js`, `full-stack.spec.js` | Real (local Supabase) |
| FastAPI → Supabase Auth (token check) | `test_supabase_auth.py`, `test_checkout_review_rejects_guest` | Real (local Supabase) |
| FastAPI → database (`/menu`, `/checkout/review`) | `test_local_database.py` | Real (local Supabase), no mocks |
| Database permissions (row-level security, grants) | `test_guest_cannot_change_the_menu`, `menu_items.sql` | Real |
| App + Login + Menu + cart + browser storage | `signin-flow.integration.test.jsx` | Real components; Supabase and `fetch` faked |
| FastAPI → database **writes** (orders) | `test_orders_database.py`, `orders.sql` | Real (local Supabase), no mocks |
| Database status → FastAPI → student (order confirmation and pickup tracking, US4/US6) | `test_order_tracking_database.py`, `order-tracking.spec.js` | Real (local Supabase), no mocks |
| App + Menu + Checkout + OrderPage + MyOrders + hash routing | `order-tracking.integration.test.jsx` | Real components; Supabase and `fetch` faked |

## Backend

Location: [backend/tests/](../backend/tests/). Run with `pytest` from `backend/`.

### Shared setup: [conftest.py](../backend/tests/conftest.py)

Contains no tests. It provides fixtures that every test file can use:

| Fixture | What it does |
|---|---|
| `clear_caches` | Runs automatically around every test. Clears the cached settings and Supabase client, so one test's settings can't leak into the next. |
| `client` | A FastAPI `TestClient` for sending requests to the app without starting a server. |
| `fake_auth` | Replaces the Supabase client with a fake. A test sets `fake_auth.result` to the user Supabase should return, or to an exception it should raise. `fake_auth.tokens` records which tokens were checked. |

### `GET /me` endpoint: [test_me.py](../backend/tests/test_me.py)

Covers `get_current_user` in [app/auth.py](../backend/app/auth.py), which protects `/me`.

| Test | What it checks |
|---|---|
| [`test_missing_token_returns_401`](../backend/tests/test_me.py#L16) | A request with no `Authorization` header gets 401 "Sign in required.", and Supabase is never called. |
| [`test_non_bearer_scheme_returns_401`](../backend/tests/test_me.py#L24) | A header that isn't `Bearer <token>` (e.g. `Basic`) gets 401. |
| [`test_valid_token_returns_user`](../backend/tests/test_me.py#L31) | A valid token returns 200 with the user's `id` and `email`, and the exact token was passed to Supabase. |
| [`test_rejected_token_returns_401`](../backend/tests/test_me.py#L43) | When Supabase rejects the token (`AuthApiError`), the response is 401. |
| [`test_unreachable_supabase_returns_503`](../backend/tests/test_me.py#L52) | When Supabase can't be reached (network error), the response is 503 "Could not reach the account service." |
| [`test_empty_response_returns_401`](../backend/tests/test_me.py#L61) | When Supabase returns nothing, the response is 401. |
| [`test_response_without_user_returns_401`](../backend/tests/test_me.py#L69) | When Supabase returns a response with no user, the response is 401. |
| [`test_unconfigured_supabase_returns_503`](../backend/tests/test_me.py#L77) | When `SUPABASE_URL`/`SUPABASE_KEY` are missing, the response is 503 "Sign-in is not configured." |

### Supabase client: [test_supabase_client.py](../backend/tests/test_supabase_client.py)

Covers `get_supabase` in [app/auth.py](../backend/app/auth.py). `create_client` is replaced, so nothing is sent to Supabase.

| Test | What it checks |
|---|---|
| [`test_creates_client_from_settings`](../backend/tests/test_supabase_client.py#L23) | The client is created with the URL and key from the settings. |
| [`test_reuses_the_same_client`](../backend/tests/test_supabase_client.py#L30) | Later calls return the same client instead of creating a new one. |
| [`test_unconfigured_settings_raise_503`](../backend/tests/test_supabase_client.py#L38) | Missing settings raise a 503 error instead of creating a broken client. |

### Menu and checkout review: [test_menu_checkout.py](../backend/tests/test_menu_checkout.py)

Covers `GET /menu` and `POST /checkout/review` in [app/menu.py](../backend/app/menu.py). The database is a fake (`MagicMock`), and sign-in is overridden where a test needs a signed-in student.

| Test | What it checks |
|---|---|
| [`test_public_menu_reads_database_and_maps_fields`](../backend/tests/test_menu_checkout.py#L39) | `/menu` reads the `menu_items` table and returns items in the shape the frontend expects (`swipeType`, `available`, …). |
| [`test_empty_menu`](../backend/tests/test_menu_checkout.py#L46) | An empty table returns an empty list. |
| [`test_unavailable_items_remain_visible`](../backend/tests/test_menu_checkout.py#L51) | Unavailable items are still listed, marked `available: false`. |
| [`test_database_failure_is_sanitized`](../backend/tests/test_menu_checkout.py#L56) | A database error returns 503 without leaking its details. |
| [`test_malformed_catalog_fails_closed`](../backend/tests/test_menu_checkout.py#L63) | A row with an invalid swipe type makes `/menu` fail rather than return bad data. |
| [`test_guest_cannot_review`](../backend/tests/test_menu_checkout.py#L68) | Checkout review without sign-in gets 401 and never reads the database. |
| [`test_invalid_token_cannot_review`](../backend/tests/test_menu_checkout.py#L73) | An invalid token gets 401. |
| [`test_valid_meal_uses_database_values_and_never_writes`](../backend/tests/test_menu_checkout.py#L79) | A complete meal is accepted using the database's values, and nothing is written. |
| [`test_invalid_quantities`](../backend/tests/test_menu_checkout.py#L94) ×7 | Quantities of 0, −1, 1.5, `"1"`, `true`, 11 or `null` are rejected with 422. |
| [`test_invalid_swipe_counts`](../backend/tests/test_menu_checkout.py#L101) ×7 | The same invalid values are rejected as a swipe count. |
| [`test_empty_and_duplicate_carts`](../backend/tests/test_menu_checkout.py#L106) | Empty carts and carts listing an item twice are rejected. |
| [`test_catalog_changes_block_checkout`](../backend/tests/test_menu_checkout.py#L113) ×3 | A deleted, unavailable or reclassified item blocks checkout with an issue for that item. |
| [`test_complete_two_swipe_meal`](../backend/tests/test_menu_checkout.py#L125) | Two of each part on two swipes passes. |
| [`test_under_and_over_filled_meals`](../backend/tests/test_menu_checkout.py#L132) | Too few or too many of one part fails with a composition issue. |
| [`test_review_fails_without_database`](../backend/tests/test_menu_checkout.py#L141) | A database outage during review returns 503. |
| [`test_extra_client_fields_rejected`](../backend/tests/test_menu_checkout.py#L146) | Extra fields sent by the browser are rejected with 422. |

### Orders: [test_orders.py](../backend/tests/test_orders.py)

Covers `POST /orders`, `GET /orders` and `GET /orders/{id}` in [app/orders.py](../backend/app/orders.py) (US3). The menu and the student's database client are fakes; the integration tests below use the real ones.

| Test | What it checks |
|---|---|
| [`test_place_order_saves_and_returns_the_order`](../backend/tests/test_orders.py#L115) | A valid meal calls `place_order` with the student's token, the key and the items, and returns the saved order (201). |
| [`test_meal_needing_review_is_not_saved`](../backend/tests/test_orders.py#L135) | An unavailable item gives 409 with the issues, and nothing is sent to the database. |
| [`test_incomplete_meal_is_not_saved`](../backend/tests/test_orders.py#L145) | A meal missing a side and a drink gives 409 with composition issues. |
| [`test_guest_cannot_place_an_order`](../backend/tests/test_orders.py#L154) | Without a token the request gets 401. |
| [`test_invalid_requests_are_rejected`](../backend/tests/test_orders.py#L167) ×4 | A missing or malformed checkout key, an extra field, or 11 swipes gives 422. |
| [`test_database_rejecting_the_meal_becomes_409`](../backend/tests/test_orders.py#L174) | If the database function refuses the meal (the menu changed in between), the student gets 409. |
| [`test_database_failures_are_sanitized`](../backend/tests/test_orders.py#L187) ×2 | Database and network errors give 503 without leaking details, and say the cart is kept. |
| [`test_order_that_cannot_be_read_back_is_503`](../backend/tests/test_orders.py#L197) | A saved order that can't be read back gives 503. |
| [`test_user_client_acts_as_the_student`](../backend/tests/test_orders.py#L205) | Database requests carry the student's token, so row-level security applies. |
| [`test_lists_the_students_orders_newest_first`](../backend/tests/test_orders.py#L221) | `GET /orders` lists the student's orders, newest first. |
| [`test_reads_one_of_the_students_orders`](../backend/tests/test_orders.py#L232) | `GET /orders/{id}` returns the order with its items in Entry, Side, Drink order. |
| [`test_an_order_the_student_cannot_see_is_404`](../backend/tests/test_orders.py#L240) | Someone else's or a missing order gives 404, so existence isn't revealed. |
| [`test_an_invalid_order_id_is_422`](../backend/tests/test_orders.py#L247) | A malformed id gives 422. |
| [`test_guest_cannot_read_orders`](../backend/tests/test_orders.py#L252) ×2 | Reading orders without a token gives 401. |
| [`test_read_failures_are_sanitized`](../backend/tests/test_orders.py#L260) ×2 | Read errors give 503 without leaking details. |

### Cancelling an order: [test_cancel_order.py](../backend/tests/test_cancel_order.py)

Covers `POST /orders/{id}/cancel` in [app/orders.py](../backend/app/orders.py) (US23), with a fake database client. The ownership and status rules are in the `cancel_order` database function, covered by the integration tests.

| Test | What it checks |
|---|---|
| [`test_student_can_cancel_their_order`](../backend/tests/test_cancel_order.py#L15) | Calls `cancel_order` with the order id and returns the cancelled order. |
| [`test_cancel_errors_are_mapped`](../backend/tests/test_cancel_order.py#L33) ×3 | Not found (or not yours) gives 404, already started gives 409, anything else gives 503, without database details. |
| [`test_cancel_requires_a_token`](../backend/tests/test_cancel_order.py#L42) | Without a token the request gets 401 and nothing reaches the database. |
| [`test_cancel_rejects_a_malformed_order_id`](../backend/tests/test_cancel_order.py#L49) | A malformed id gives 422. |
| [`test_kitchen_cannot_reopen_a_cancelled_order`](../backend/tests/test_cancel_order.py#L56) | A kitchen status change to a cancelled order gives 409. |

### Settings: [test_config.py](../backend/tests/test_config.py)

Covers `get_settings` and `Settings` in [app/config.py](../backend/app/config.py).

| Test | What it checks |
|---|---|
| [`test_reads_and_trims_environment`](../backend/tests/test_config.py#L8) | The Supabase URL and key are read from the environment with surrounding spaces and newlines removed, and count as configured. |
| [`test_missing_environment_is_not_configured`](../backend/tests/test_config.py#L19) | With neither variable set, both values are empty and Supabase counts as not configured. |
| [`test_blank_value_is_not_configured`](../backend/tests/test_config.py#L38) ×3 | Supabase counts as not configured if the URL is blank, the key is blank, or both are. |

### CORS: [test_cors.py](../backend/tests/test_cors.py)

Covers the CORS settings in [app/main.py](../backend/app/main.py), which decide which websites may call the backend from a browser.

| Test | What it checks |
|---|---|
| [`test_frontend_origin_is_allowed`](../backend/tests/test_cors.py#L18) ×2 | Browser preflight requests from the dev frontend (`http://localhost:5173` and `http://127.0.0.1:5173`) are allowed, including the `Authorization` header. |
| [`test_unknown_origin_is_rejected`](../backend/tests/test_cors.py#L26) | A preflight request from any other website is rejected with 400 and no allow header. |

### Contract with the frontend: [test_contract.py](../backend/tests/test_contract.py)

Checks what the frontend relies on from the backend.

| Test | What it checks |
|---|---|
| [`test_me_route_accepts_get`](../backend/tests/test_contract.py#L10) | `GET /me` exists, which the login page calls through `/api/me`. |
| [`test_me_returns_only_id_and_email`](../backend/tests/test_contract.py#L16) | `/me` returns JSON with exactly `id` and `email`, and no other user data such as a phone number or metadata. |
| [`test_me_returns_id_as_a_string`](../backend/tests/test_contract.py#L32) | The user id is always a string. |
| [`test_settings_come_from_the_repo_root_env`](../backend/tests/test_contract.py#L40) | The backend reads `.env` from the repo root, the same file the frontend uses. |

### Integration: API → auth → database: [integration/test_local_database.py](../backend/tests/integration/test_local_database.py)

Marked `integration`. No mocks: requests go through FastAPI, `get_current_user` and `app/menu.py` into the local Supabase database. Tests that change data restore it afterwards, and only run when `SUPABASE_URL` is local.

| Test | What it checks |
|---|---|
| [`test_menu_reads_seeded_rows_from_database`](../backend/tests/integration/test_local_database.py#L69) | `/menu` returns exactly the 22 rows stored by the migration, in their stored order and shape. |
| [`test_menu_reflects_a_database_change`](../backend/tests/integration/test_local_database.py#L84) | After an item is marked unavailable in the database, `/menu` shows it as unavailable. |
| [`test_checkout_review_with_real_login`](../backend/tests/integration/test_local_database.py#L92) | A real sign-in token and a full meal pass review, using names and types from the database. |
| [`test_checkout_review_flags_item_unavailable_in_database`](../backend/tests/integration/test_local_database.py#L102) | **Failure path:** an item made unavailable in the database blocks checkout with an `unavailable` issue. |
| [`test_checkout_review_rejects_guest`](../backend/tests/integration/test_local_database.py#L111) | **Failure path:** without a token, review is refused with 401. |
| [`test_checkout_review_never_writes_to_the_database`](../backend/tests/integration/test_local_database.py#L117) | The menu table is identical before and after a review. |
| [`test_guest_cannot_change_the_menu`](../backend/tests/integration/test_local_database.py#L125) | **Failure path:** the database refuses a guest's update, and the row is unchanged. |

### Integration: placing orders: [integration/test_orders_database.py](../backend/tests/integration/test_orders_database.py)

Marked `integration`. No mocks: orders go through FastAPI, `app/orders.py` and the `place_order` database function into the local Supabase database. Orders created by a test are deleted afterwards.

| Test | What it checks |
|---|---|
| [`test_placing_an_order_stores_it_in_the_database`](../backend/tests/integration/test_orders_database.py#L92) | **Stored result:** placing an order through the API stores one `orders` row (right student, Received, 1 swipe) and its three `order_items` rows. |
| [`test_retrying_with_the_same_key_stores_one_order`](../backend/tests/integration/test_orders_database.py#L114) | Submitting twice with the same key returns the same order and stores only one. |
| [`test_the_student_can_read_and_list_their_order`](../backend/tests/integration/test_orders_database.py#L127) | The student can read the order back and sees it in their list. |
| [`test_another_student_cannot_read_the_order`](../backend/tests/integration/test_orders_database.py#L137) | **Failure path:** a second student gets 404 and doesn't see it in their list. |
| [`test_unavailable_item_is_refused_and_nothing_is_stored`](../backend/tests/integration/test_orders_database.py#L146) | **Failure path:** an item made unavailable gives 409 and stores nothing. |
| [`test_guest_cannot_place_an_order`](../backend/tests/integration/test_orders_database.py#L156) | **Failure path:** without a token, 401 and nothing stored. |
| [`test_student_cannot_insert_an_order_directly`](../backend/tests/integration/test_orders_database.py#L165) | **Failure path:** a student writing to `orders` directly, bypassing the API, is refused. |
| [`test_database_function_rechecks_the_meal`](../backend/tests/integration/test_orders_database.py#L177) | **Failure path:** the database function itself refuses an incomplete meal (errcode 22023). |

### Integration: order confirmation and pickup tracking: [integration/test_order_tracking_database.py](../backend/tests/integration/test_order_tracking_database.py)

Marked `integration`. No mocks: reads go through FastAPI, real auth and `app/orders.py` into the local Supabase database (US4, US6). A status change is written to the database with the service key, the way a staff update (US5) stores it. Orders created by a test are deleted afterwards.

| Test | What it checks |
|---|---|
| [`test_confirmation_reads_back_the_saved_order`](../backend/tests/integration/test_order_tracking_database.py#L69) | **Stored result:** after placing an order, `GET /orders/{id}` returns exactly the saved order, Received, with its three items. |
| [`test_student_sees_the_latest_stored_status`](../backend/tests/integration/test_order_tracking_database.py#L81) ×3 | After the stored status changes to Preparing, Ready or Collected, both `GET /orders/{id}` and `GET /orders` return it. |
| [`test_another_student_cannot_track_the_order`](../backend/tests/integration/test_order_tracking_database.py#L92) | **Failure path:** a second student gets 404 "Order not found." for the first student's order. |
| [`test_student_cannot_change_their_own_order_status`](../backend/tests/integration/test_order_tracking_database.py#L102) | **Failure path:** the database refuses a student's own token updating the status, and it stays Received. |
| [`test_database_rejects_an_unknown_status`](../backend/tests/integration/test_order_tracking_database.py#L110) | **Failure path:** the database refuses a status outside Received, Preparing, Ready, Collected. |
| [`test_guest_cannot_track_an_order`](../backend/tests/integration/test_order_tracking_database.py#L118) | **Failure path:** reading one order or the list without a token gives 401. |
| [`test_student_cancels_a_received_order`](../backend/tests/integration/test_order_tracking_database.py#L123) | **US23, stored result:** cancelling stores Cancelled; cancelling again still succeeds. |
| [`test_another_student_cannot_cancel_the_order`](../backend/tests/integration/test_order_tracking_database.py#L136) | **US23 failure path:** a second student gets 404 and the order stays Received. |
| [`test_cancel_is_refused_once_the_kitchen_starts`](../backend/tests/integration/test_order_tracking_database.py#L144) | **US23 failure path:** once the order is Preparing, cancelling gives 409 and the status is unchanged. |

### Integration: real sign-in: [integration/test_supabase_auth.py](../backend/tests/integration/test_supabase_auth.py)

Marked `integration`. Uses the test user that CI creates in the local Supabase.

| Test | What it checks |
|---|---|
| [`test_real_token_returns_the_signed_in_user`](../backend/tests/integration/test_supabase_auth.py#L42) | Signs the test user in with Supabase, sends the real token to `/me`, and gets 200 with the same email. |
| [`test_garbage_token_is_rejected`](../backend/tests/integration/test_supabase_auth.py#L49) | **Failure path:** real Supabase rejects a made-up token, so `/me` returns 401. |
| [`test_token_with_tampered_signature_is_rejected`](../backend/tests/integration/test_supabase_auth.py#L55) | **Failure path:** a real token with a changed signature is rejected with 401. |

### Release server: [test_serve.py](../backend/tests/test_serve.py)

Covers [serve.py](../backend/serve.py), which runs the release artifact as one process.

| Test | What it checks |
|---|---|
| [`test_serves_the_built_frontend_at_the_root`](../backend/tests/test_serve.py#L21) | The built frontend is served at `/`. |
| [`test_serves_the_api_under_api`](../backend/tests/test_serve.py#L28) | The API is reachable under `/api` (e.g. `/api/me` gives 401 without a token). |
| [`test_missing_frontend_build_gives_a_clear_error`](../backend/tests/test_serve.py#L35) | Without a frontend build, it fails with a message saying how to fix it. |

## Frontend

Location: [frontend/src/](../frontend/src/), in files ending in `.test.js` or `.test.jsx`. Run with `npm test` from `frontend/`.

### Shared setup: [test/setup.js](../frontend/src/test/setup.js)

Contains no tests. Vitest runs it before every test file (configured in the `test` block of [vite.config.js](../frontend/vite.config.js)). It adds DOM checks such as `toBeInTheDocument()` and `toBeDisabled()`, and clears the rendered page after each test. Tests run in `jsdom`, a simulated browser. Files in `frontend/e2e/` are excluded; those are Playwright tests.

### Cart rules: [cart.test.js](../frontend/src/cart.test.js)

Covers [cart.js](../frontend/src/cart.js), which enforces the meal-swipe rules: each swipe covers one Entry, one Side and one Drink, up to 10 swipes. Every function takes the current menu, and changes that break a rule are rejected (the cart is returned unchanged). The first 14 tests came from the menu-and-checkout work; the rest are boundary and edge cases. `npm run test:cart` runs this file alone.

| Test | What it checks |
|---|---|
| [one swipe holds exactly one entry, side, and drink](../frontend/src/cart.test.js#L7) | One of each type on one swipe, and that cart passes review. |
| [database-only IDs work without changes to frontend constants](../frontend/src/cart.test.js#L14) | Items that exist only in the database can be added. |
| [entry capacity is enforced and milkshakes remain entries](../frontend/src/cart.test.js#L18) | Milkshakes use the Entry slot, and a second Entry on one swipe is rejected. |
| [removing an item is immutable and can remove a deleted catalog ID](../frontend/src/cart.test.js#L23) | Removing works even for items no longer on the menu, and the original cart isn't changed. |
| [more swipes unlock quantities and cannot be reduced below usage](../frontend/src/cart.test.js#L28) | More swipes allow more items; swipes can't drop below what's in the cart. |
| [invalid swipe counts are rejected rather than silently rounded or capped](../frontend/src/cart.test.js#L33) | 0, −1, 1.5, `"2"`, `true`, `NaN` and 11 leave the cart unchanged. |
| [invalid quantities and unknown or unavailable items are rejected](../frontend/src/cart.test.js#L38) | Bad quantities, unknown items and unavailable items leave the cart unchanged. |
| [cart restoration retains removed IDs and original reviewed types](../frontend/src/cart.test.js#L44) | A saved cart keeps items that have left the menu, so the student can see and remove them. |
| [corrupt storage and invalid shapes return a fresh cart](../frontend/src/cart.test.js#L49) | Broken or unexpected saved data gives an empty one-swipe cart. |
| [restoration rejects invalid quantities and dangerous property names](../frontend/src/cart.test.js#L52) | Bad quantities and names like `__proto__` are dropped. |
| [search combines categories with case-insensitive trimmed queries](../frontend/src/cart.test.js#L55) | Search and category filters work together. |
| [empty, incomplete, over-capacity, and invalid carts cannot pass review](../frontend/src/cart.test.js#L60) | Each kind of bad cart produces review errors. |
| [unavailable items fail review](../frontend/src/cart.test.js#L63) | An unavailable item blocks review. |
| [quantity edits preserve original classification for server change detection](../frontend/src/cart.test.js#L66) | The swipe type the student saw is kept, so the server can spot menu changes. |
| [zero removes the item, one keeps it, and negative is rejected](../frontend/src/cart.test.js#L79) | Boundary values 0, 1 and −1. |
| [quantities just below and at the swipe count are accepted, just above is rejected](../frontend/src/cart.test.js#L86) | With 3 swipes: 2 and 3 are accepted, 4 is rejected. |
| [other items of the same type shrink the allowance](../frontend/src/cart.test.js#L93) | Other Entries reduce what's left; a full type rejects more. |
| [an item does not count against its own allowance](../frontend/src/cart.test.js#L102) | Re-setting an item's quantity isn't blocked by itself. |
| [MAX_SWIPES is reachable but one more is rejected](../frontend/src/cart.test.js#L108) | With 10 swipes, 10 is accepted and 11 rejected. |
| [MAX_SWIPES itself is accepted](../frontend/src/cart.test.js#L116) | Swipes can be set to exactly 10. |
| [swipes can drop to exactly the busiest type but not below it](../frontend/src/cart.test.js#L120) | With 2 Entries, swipes can go to 2 but not 1. |
| [does not modify the original cart](../frontend/src/cart.test.js#L126) | `setSwipes` returns a new cart. |
| [1 and MAX_SWIPES are restored; 0 and one more give a fresh cart](../frontend/src/cart.test.js#L134) | Saved swipe counts at and just outside the 1–10 range. |
| [invalid saved swipe counts give a fresh cart](../frontend/src/cart.test.js#L141) | Saved swipes of −1, 1.5, `"2"` or `null` give an empty cart. |
| [missing or array items give a fresh cart](../frontend/src/cart.test.js#L147) | A saved cart without a valid item list is discarded. |
| [item ids up to 100 characters are kept; longer ids are dropped](../frontend/src/cart.test.js#L152) | The 100-character id limit, at and just over. |
| [keeps reviewed types only for items in the cart and only valid types](../frontend/src/cart.test.js#L158) | Stale or invalid saved swipe types are dropped. |
| [items no longer on the menu are listed but do not count toward a meal](../frontend/src/cart.test.js#L165) | Removed items show as unavailable and don't fill a meal slot. |
| [search matches dietary labels](../frontend/src/cart.test.js#L172) | Searching "vegan" finds exactly the Vegan items. |
| [an empty search with a category returns exactly that category](../frontend/src/cart.test.js#L178) | A category filter alone returns only that category. |
| [a complete two-swipe meal passes review](../frontend/src/cart.test.js#L184) | Two of each part on two swipes has no errors. |
| [review explains which part of the meal is short](../frontend/src/cart.test.js#L189) | A missing drink produces exactly one clear message. |

The last four cart tests cover the **checkout key**: `withCheckoutKey` adds one UUID and keeps it; a saved key survives a restore but an invalid one is dropped; changing the cart drops the key (it becomes a new order); a rejected change keeps it.

### Menu data: [menu-data.test.js](../frontend/src/menu-data.test.js)

Covers [menu-data.js](../frontend/src/menu-data.js), the seed menu that the database migration and the tests use, so that an edit can't silently break it.

| Test | What it checks |
|---|---|
| [every item has a unique id](../frontend/src/menu-data.test.js#L10) | No two items share an id; the cart relies on ids. |
| [every item has a name, category, portion, and known swipe type](../frontend/src/menu-data.test.js#L15) | Required fields are filled in, and `swipeType` is Entry, Side or Drink. |
| [every swipe type has at least one item, so a full meal swipe is possible](../frontend/src/menu-data.test.js#L24) | Students can always complete a meal swipe. |
| [categories start with All, have no duplicates, and each has items](../frontend/src/menu-data.test.js#L30) | The category buttons make sense. |
| [every image file exists](../frontend/src/menu-data.test.js#L40) | Each item's photo is in `public/images/menu/`. |
| [every image is credited in CREDITS.md](../frontend/src/menu-data.test.js#L46) | Each photo has an attribution entry, as its license requires. |

### Supabase client helper: [supabase.test.js](../frontend/src/supabase.test.js)

Covers `getSupabase` in [supabase.js](../frontend/src/supabase.js). The real `@supabase/supabase-js` library is replaced with a fake, and the environment variables are set per test.

| Test | What it checks |
|---|---|
| [returns null when the URL is missing](../frontend/src/supabase.test.js#L22) | With no `SUPABASE_URL`, no client is created. |
| [returns null when the key is missing](../frontend/src/supabase.test.js#L31) | With no `SUPABASE_KEY`, no client is created. |
| [creates the client once and reuses it](../frontend/src/supabase.test.js#L39) | With both set, the client is created with the right URL and key, and later calls return the same client. |

### Login page: [Login.test.jsx](../frontend/src/Login.test.jsx)

Covers [Login.jsx](../frontend/src/Login.jsx). The tests render the page and use it like a person would: typing into fields and clicking buttons. `getSupabase` is replaced with a fake whose `signInWithPassword` and `signUp` each test controls, and `fetch` (used for the backend's `/api/me` check) is faked too.

#### Form validation

These run before anything is sent to Supabase.

| Test | What it checks |
|---|---|
| [requires email and password](../frontend/src/Login.test.jsx#L43) | Submitting an empty form shows "Enter your email." and "Enter your password.", marks the email field invalid, and doesn't call Supabase. |
| [rejects a badly formed email](../frontend/src/Login.test.jsx#L54) | An email like `not-an-email` shows "Enter a valid email address." |
| [requires the confirmation password on sign up](../frontend/src/Login.test.jsx#L64) | On Sign up, leaving "Confirm password" empty shows "Confirm your password." |
| [rejects mismatched passwords on sign up](../frontend/src/Login.test.jsx#L75) | On Sign up, two different passwords show "Passwords do not match." |

#### Form controls

| Test | What it checks |
|---|---|
| [shows and hides the password](../frontend/src/Login.test.jsx#L89) | The Show/Hide button switches the password between hidden and visible text. |
| [switches tabs and clears errors](../frontend/src/Login.test.jsx#L103) | Switching to Sign up clears existing errors and adds the "Confirm password" field and a "Create account" button; switching back removes the field. |
| [explains when Supabase is not configured](../frontend/src/Login.test.jsx#L121) | With no Supabase settings, submitting shows "Sign-in is not configured yet." and makes no request. |

#### Signing in

| Test | What it checks |
|---|---|
| [signs in and confirms the session with the backend](../frontend/src/Login.test.jsx#L151) | A successful sign-in trims spaces from the email, sends the token to `/api/me` as `Bearer <token>`, and shows "Signed in as …". |
| [shows a message for the … error](../frontend/src/Login.test.jsx#L169) ×3 | Supabase error codes show the right message: `invalid_credentials` → "Email or password is incorrect.", `email_not_confirmed` → "You need to confirm your email…", anything else → "Could not sign in. Try again." |
| [handles a response with no session and no error](../frontend/src/Login.test.jsx#L184) | If Supabase returns neither a session nor an error, the generic "Could not sign in" message appears. |
| [shows the backend error when the session cannot be confirmed](../frontend/src/Login.test.jsx#L194) | If `/api/me` fails, the backend's error message is shown and the "Signed in" message isn't. |
| [falls back to a generic message when the backend returns no JSON](../frontend/src/Login.test.jsx#L206) | If `/api/me` fails without a readable body, "The server could not confirm this sign-in." is shown. |
| [disables the submit button while signing in](../frontend/src/Login.test.jsx#L217) | While sign-in is in progress, the button reads "Signing in…" and can't be clicked; it's enabled again afterwards. |

#### Signing up

| Test | What it checks |
|---|---|
| [shows a message for the … error](../frontend/src/Login.test.jsx#L235) ×4 | Supabase error codes show the right message: `user_already_exists` and `email_exists` → "An account with this email already exists.", `weak_password` → "Use at least 6 characters.", anything else → "Could not create the account. Try again." |
| [sends the user to sign in when email confirmation is required](../frontend/src/Login.test.jsx#L254) | If Supabase creates the account without a session, the page switches to Sign in, keeps the email, clears the password, and shows "Account created. Sign in to continue." |
| [signs in immediately when Supabase returns a session](../frontend/src/Login.test.jsx#L268) | If Supabase returns a session right away, the page confirms it with `/api/me` and shows "Signed in as …". |

#### Callbacks to the app

| Test | What it checks |
|---|---|
| [reports the signed-in email after signing in](../frontend/src/Login.test.jsx#L284) | `onSignedIn` is called once with the email, so the app can open the menu. |
| [reports the signed-in email after a sign-up that returns a session](../frontend/src/Login.test.jsx#L297) | The same happens after a sign-up that signs the user in right away. |
| [does not report a sign-in that Supabase rejects](../frontend/src/Login.test.jsx#L310) | A failed sign-in doesn't open the menu. |
| [does not report a sign-in the backend cannot confirm](../frontend/src/Login.test.jsx#L322) | If `/api/me` fails, the menu isn't opened. |
| [shows Browse menu only when the app provides it](../frontend/src/Login.test.jsx#L335) | The button appears and calls `onBrowse`. |
| [hides Browse menu without a handler](../frontend/src/Login.test.jsx#L344) | Without `onBrowse`, there's no button. |
| [disables Browse menu while signing in](../frontend/src/Login.test.jsx#L350) | The user can't leave mid-sign-in. |

### Menu page and checkout review: [Menu.test.jsx](../frontend/src/Menu.test.jsx)

Covers loading the menu from `/api/menu`, [Menu.jsx](../frontend/src/Menu.jsx) and [Checkout.jsx](../frontend/src/Checkout.jsx), with a small three-item menu. Supabase and `fetch` are faked.

| Test | What it checks |
|---|---|
| [shows loading, then database items and combined search/category filters](../frontend/src/Menu.test.jsx#L37) | "Loading menu…" first, then the items; search and category filters combine, and Reset filters works. |
| [shows empty catalog and disables empty checkout](../frontend/src/Menu.test.jsx#L50) | An empty menu shows a message and checkout is disabled. |
| [shows a failed menu request and retries successfully](../frontend/src/Menu.test.jsx#L55) | A failed load shows **Retry menu**, which works. |
| [rejects malformed menu responses](../frontend/src/Menu.test.jsx#L60) | A bad response from `/api/menu` shows an error instead of broken items. |
| [cannot add unavailable items](../frontend/src/Menu.test.jsx#L64) | Unavailable items can't be added. |
| [shows quantities and total, checks server, and retains cart after success](../frontend/src/Menu.test.jsx#L68) | Checkout review shows the meal, sends it to the server with the login token, and keeps the cart. |
| [blocks empty, invalid, or incomplete checkout](../frontend/src/Menu.test.jsx#L79) ×6 | Bad or incomplete carts can't be validated, and nothing is sent. |
| [asks guest to sign in without discarding cart](../frontend/src/Menu.test.jsx#L83) | Guests are asked to sign in, and the cart stays. |
| [expired server session requires sign-in](../frontend/src/Menu.test.jsx#L90) | A 401 from the server asks the student to sign in again. |
| [blocks changed types and unavailable items until reviewed](../frontend/src/Menu.test.jsx#L95) | Menu changes found by the server must be reviewed before continuing. |
| [handles failed validation and allows retry](../frontend/src/Menu.test.jsx#L107) | A failed check shows the error and can be retried. |
| [ignores stale validation response after cart changes](../frontend/src/Menu.test.jsx#L114) | A slow answer for an old cart is ignored. |
| [preserves checkout through login navigation when storage is blocked](../frontend/src/Menu.test.jsx#L123) | Signing in from checkout keeps the review, even with browser storage blocked. |
| [builds a meal through clicks and the header returns from checkout to cart](../frontend/src/Menu.test.jsx#L137) | A meal built by clicking can be reviewed, and the header Cart button returns to the cart. |
| [refreshes catalog without dropping a saved cart or its reviewed classifications](../frontend/src/Menu.test.jsx#L150) | **Refresh menu** keeps the cart and marks newly unavailable items. |

### Menu page with the full menu: [Menu.cart.test.jsx](../frontend/src/Menu.cart.test.jsx)

Covers browsing and building a cart in [Menu.jsx](../frontend/src/Menu.jsx) with the full seed menu served as `/api/menu`. Browser storage is cleared before each test.

| Test | What it checks |
|---|---|
| [shows every menu item](../frontend/src/Menu.cart.test.jsx#L42) | All items from the menu are listed with the right count. |
| [builds the category buttons from the menu and filters by category](../frontend/src/Menu.cart.test.jsx#L49) | Category buttons come from the menu; one shows only its items. |
| [falls back to a placeholder when an image fails to load](../frontend/src/Menu.cart.test.jsx#L60) | A broken photo is replaced with a "No image" placeholder. |
| [adds an item and updates the cart, header count, and notice](../frontend/src/Menu.cart.test.jsx#L71) | Adding updates the cart, the header's cart count, and the announcement. |
| [shows how many of an item are in the cart while more can be added](../frontend/src/Menu.cart.test.jsx#L82) | The add button shows "1 in cart". |
| [blocks more items of a full type but not other types](../frontend/src/Menu.cart.test.jsx#L91) | After one Entry on one swipe, other Entries show "Entry limit reached"; Sides and Drinks stay available. |
| [shows progress for each part of a meal swipe](../frontend/src/Menu.cart.test.jsx#L102) | Entries, Sides and Drinks each show 1/1. |
| [cannot go below one swipe](../frontend/src/Menu.cart.test.jsx#L116) | The − button is disabled at 1 swipe. |
| [raising swipes allows another item of the same type](../frontend/src/Menu.cart.test.jsx#L123) | A second swipe re-enables Entries. |
| [cannot drop below the number of items of the busiest type](../frontend/src/Menu.cart.test.jsx#L133) | With 2 Entries, swipes can't go below 2. |
| [stops at 10 swipes](../frontend/src/Menu.cart.test.jsx#L143) | The + button is disabled at the maximum. |
| [changes quantity within the swipe allowance](../frontend/src/Menu.cart.test.jsx#L157) | Cart +/− change the quantity, and + stops at the limit. |
| [decreasing to zero empties the cart](../frontend/src/Menu.cart.test.jsx#L172) | Removing the last item shows the empty cart. |
| [removes a single item](../frontend/src/Menu.cart.test.jsx#L181) | **Remove** takes out one item and leaves the rest. |
| [clears the whole cart](../frontend/src/Menu.cart.test.jsx#L193) | **Clear cart** empties it, announces it, and saves the empty cart. |
| [saves changes to browser storage](../frontend/src/Menu.cart.test.jsx#L208) | The cart is saved to localStorage after each change. |
| [restores a saved cart](../frontend/src/Menu.cart.test.jsx#L217) | A saved cart is shown when the page opens. |
| [starts empty when the saved cart is corrupt](../frontend/src/Menu.cart.test.jsx#L226) | Broken saved data gives an empty cart instead of an error. |
| [explains when browser storage is unavailable](../frontend/src/Menu.cart.test.jsx#L235) | If saving fails (e.g. private browsing), the page says so. |
| [shows the signed-in email and a way back to login](../frontend/src/Menu.cart.test.jsx#L247) | Signed-in users see their email, and **Back to login** works. |
| [offers sign in when browsing without an account](../frontend/src/Menu.cart.test.jsx#L258) | Guests see **Sign in** instead. |
| [the header cart button moves focus to the cart](../frontend/src/Menu.cart.test.jsx#L265) | The header's Cart button focuses the cart heading. |
| [the skip link moves focus to the menu](../frontend/src/Menu.cart.test.jsx#L273) | The "Skip to menu" link works for keyboard users. |

### Placing an order: [place-order.test.jsx](../frontend/src/place-order.test.jsx)

Covers ordering from checkout (US3) with the real Menu, Checkout, cart rules and browser storage; Supabase and `fetch` are faked.

| Test | What it checks |
|---|---|
| [only offers Place order after a valid review](../frontend/src/place-order.test.jsx#L75) | **Place order** appears only once the server has confirmed the meal. |
| [sends the meal with the login token and a checkout key, then clears the cart](../frontend/src/place-order.test.jsx#L89) | The request carries the token, the meal and a UUID key; afterwards the saved order is handed to the app (which opens its confirmation page) and the cart is empty. |
| [retries a failed attempt with the same checkout key and keeps the cart meanwhile](../frontend/src/place-order.test.jsx#L110) | After a failed attempt the cart and its key are kept, and the retry sends the same key, so it can't create a second order. |
| [shows the latest review when the menu changed before ordering, and keeps the cart](../frontend/src/place-order.test.jsx#L127) | A 409 re-runs the review and shows what changed; no confirmation opens and the cart stays. |
| [asks the student to sign in again when the session expired](../frontend/src/place-order.test.jsx#L143) | A 401 shows **Sign in and keep cart**. |
| [disables Place order while the order is being saved](../frontend/src/place-order.test.jsx#L153) | The button reads "Placing order…" and can't be clicked twice. |
| [opens no confirmation when the order was not saved](../frontend/src/place-order.test.jsx#L165) | A failed save shows the error and never opens a confirmation. |
| [acknowledges a saved order after Back to cart unmounts checkout](../frontend/src/place-order.test.jsx#L177) | An order that finishes saving after the student left the review still clears the cart and opens its confirmation. |
| [keeps a newly edited cart when an earlier order finishes saving](../frontend/src/place-order.test.jsx#L188) | A cart changed while the order was saving is kept, not cleared. |

### Order status rules: [order-status.test.js](../frontend/src/order-status.test.js)

Covers [order-status.js](../frontend/src/order-status.js), the rules shared by the confirmation page, pickup tracking and My orders (US4, US6).

| Test | What it checks |
|---|---|
| [statusSteps](../frontend/src/order-status.test.js#L14) ×4 | Each of the four steps is marked done, current or upcoming; Collected shows the whole journey done; Ready is labelled "Ready for pickup"; the order matches the database's allowed statuses. |
| [status wording](../frontend/src/order-status.test.js#L32) ×3 | Every status has a title and a next step; an unknown status falls back to its raw value; "meal swipe(s)" is pluralized. |
| [order ids](../frontend/src/order-status.test.js#L52) ×2 | Only UUIDs count as order ids, so a mistyped link never reaches the API; the counter number is the first 8 characters in capitals. |
| [isOpenOrder](../frontend/src/order-status.test.js#L65) | Every status except Collected and Cancelled keeps the page checking for updates. |
| [canCancel](../frontend/src/order-status.test.js#L74) | Only a Received order offers Cancel (US23). |
| [isOrder](../frontend/src/order-status.test.js#L73) ×7 | A response shaped like the API's order is accepted; a missing body, bad id, unknown status, zero swipes or bad items are rejected. |
| [formatPlacedAt](../frontend/src/order-status.test.js#L90) ×3 | "today at …" for today's orders, the date for older ones, nothing for an unreadable time. |

### Reading orders from the API: [order-api.test.js](../frontend/src/order-api.test.js)

Covers [order-api.js](../frontend/src/order-api.js) (US4, US6). Supabase and `fetch` are faked.

| Test | What it checks |
|---|---|
| [reads one order with the login token and without the browser cache](../frontend/src/order-api.test.js#L28) | `GET /api/orders/{id}` carries `Bearer <token>` and `cache: no-store`, so a status is never stale. |
| [treats a malformed id as not found without calling the API](../frontend/src/order-api.test.js#L36) | A non-UUID id is "not found" and no request is made. |
| [asks a guest to sign in without calling the API](../frontend/src/order-api.test.js#L41) | With no session, it asks for sign-in and makes no request. |
| [asks for sign-in when Supabase is not configured or the session read fails](../frontend/src/order-api.test.js#L47) | Both cases ask for sign-in. |
| [asks for sign-in again when the token expired](../frontend/src/order-api.test.js#L54) | A 401 asks for sign-in. |
| [reports another student's order the same way as a missing one](../frontend/src/order-api.test.js#L59) | A 404 is "not found", whoever owns the order. |
| [throws a friendly error when the server fails](../frontend/src/order-api.test.js#L64) | A 503 becomes "Could not load your order. Please try again." |
| [rejects a response that is not the requested order](../frontend/src/order-api.test.js#L69) | A different order's id, or a body that isn't JSON, is treated as a failure. |
| [lists the student's orders](../frontend/src/order-api.test.js#L78) | `GET /api/orders` returns the list. |
| [asks a guest or an expired session to sign in](../frontend/src/order-api.test.js#L84) | No session or a 401 asks for sign-in. |
| [throws when the server fails or sends something that is not a list of orders](../frontend/src/order-api.test.js#L91) | A server error or a malformed list throws a friendly error. |
| [posts the cancel with the login token](../frontend/src/order-api.test.js#L100) | **US23:** `POST /api/orders/{id}/cancel` carries `Bearer <token>` and returns the cancelled order. |
| [reports a %i without throwing](../frontend/src/order-api.test.js#L112) ×3 | 401 asks for sign-in, 404 is not found, 409 means the kitchen already started. |
| [throws a friendly error when the server fails](../frontend/src/order-api.test.js#L118) | A 503 becomes "Could not cancel this order. Please try again." |

### Order confirmation and pickup tracking: [OrderPage.test.jsx](../frontend/src/OrderPage.test.jsx)

Covers [OrderPage.jsx](../frontend/src/OrderPage.jsx) (US4, US6). The API module is faked so each test sets what the server returns.

| Test | What it checks |
|---|---|
| [shows the just-saved order at once, then re-reads it from the server](../frontend/src/OrderPage.test.jsx#L44) | **US4:** "Order received" with the order number, items, total and Received step, then a fresh read from the server. |
| [loads the saved order after a refresh, when nothing was passed in](../frontend/src/OrderPage.test.jsx#L58) | **US4:** after a refresh the page loads the order from the server. |
| [ignores a passed-in order that is not the one in the URL](../frontend/src/OrderPage.test.jsx#L67) | Only the order in the URL is ever shown. |
| [says an order is missing, including another student's order, without showing it](../frontend/src/OrderPage.test.jsx#L77) | **Failure path:** a 404 shows "We couldn't find that order" and links to My orders. |
| [asks a signed-out student to sign in](../frontend/src/OrderPage.test.jsx#L87) | A guest is asked to sign in. |
| [shows a retry when the order cannot be loaded, then recovers](../frontend/src/OrderPage.test.jsx#L96) | **Failure path:** a failed first load shows the error and **Try again**, which recovers. |
| [sends the student back to the menu or to all orders](../frontend/src/OrderPage.test.jsx#L106) | **Order something else** and **View all my orders** work. |
| [shows the latest stored status when the student refreshes it](../frontend/src/OrderPage.test.jsx#L119) | **US6:** **Refresh status** shows the new status and announces it to screen readers. |
| [makes Ready for pickup unmissable, including in the browser tab title](../frontend/src/OrderPage.test.jsx#L131) | **US6:** Ready uses the highlighted panel, says what to do, and sets the tab title. |
| [restores the tab title when the student leaves the page](../frontend/src/OrderPage.test.jsx#L142) | The tab title goes back afterwards. |
| [checks for a new status on its own while the order is open](../frontend/src/OrderPage.test.jsx#L153) | **US6:** the page re-reads the order every 15 seconds and shows the new status. |
| [stops checking once the order has been picked up](../frontend/src/OrderPage.test.jsx#L165) | A Collected order stops polling. |
| [does not check while the tab is hidden, and checks again when it comes back](../frontend/src/OrderPage.test.jsx#L178) | No requests from a background tab; one as soon as it's visible again. |
| [keeps the last status on screen when a refresh fails](../frontend/src/OrderPage.test.jsx#L193) | **Failure path:** a failed refresh keeps the last status and says it may be out of date. |
| [shows the not-found page if the order disappears while open](../frontend/src/OrderPage.test.jsx#L205) | A 404 on refresh switches to not found. |
| [ignores an older response that arrives after a newer one](../frontend/src/OrderPage.test.jsx#L215) | A slow, older response can't overwrite a newer status. |
| [cancels a Received order after the student confirms](../frontend/src/OrderPage.test.jsx#L234) | **US23:** **Cancel order** asks to confirm, then shows Cancelled without the progress steps or the button. |
| [does nothing when the student changes their mind](../frontend/src/OrderPage.test.jsx#L246) | Dismissing the confirmation sends nothing. |
| [explains when the kitchen started first and shows the new status](../frontend/src/OrderPage.test.jsx#L255) | **US23 failure path:** a 409 explains why and shows the latest status. |
| [offers no cancel once the kitchen has started](../frontend/src/OrderPage.test.jsx#L268) | A Preparing order has no **Cancel order** button. |

### My orders: [MyOrders.test.jsx](../frontend/src/MyOrders.test.jsx)

Covers [MyOrders.jsx](../frontend/src/MyOrders.jsx) (US6). The API module is faked.

| Test | What it checks |
|---|---|
| [separates orders still in progress from ones already picked up](../frontend/src/MyOrders.test.jsx#L28) | Orders are grouped into "In progress" and "Picked up" with their status. |
| [opens an order from the list](../frontend/src/MyOrders.test.jsx#L39) | **View** opens that order. |
| [points a student with no orders back to the menu](../frontend/src/MyOrders.test.jsx#L48) | An empty list links to the menu. |
| [asks a signed-out student to sign in](../frontend/src/MyOrders.test.jsx#L57) | A guest is asked to sign in. |
| [shows the error and loads again on retry or refresh](../frontend/src/MyOrders.test.jsx#L66) | **Failure path:** a failed load shows the error; **Try again** and **Refresh list** reload. |

### Page switching: [App.test.jsx](../frontend/src/App.test.jsx)

Covers [App.jsx](../frontend/src/App.jsx), which switches between the login page and the menu using the address (`#menu` / `#login`). The menu stays loaded in the background so the cart survives a trip to the login page.

| Test | What it checks |
|---|---|
| [starts on the login page](../frontend/src/App.test.jsx#L30) | With no `#` in the address, the login page shows. |
| [opens the menu directly when the address ends in #menu](../frontend/src/App.test.jsx#L37) | A link or bookmark to `#menu` opens the menu. |
| [Browse menu opens the menu and updates the address](../frontend/src/App.test.jsx#L45) | The button opens the menu and sets `#menu`. |
| [Sign in on the menu returns to the login page](../frontend/src/App.test.jsx#L55) | The menu's **Sign in** goes back to login and sets `#login`. |
| [follows address changes such as the browser back button](../frontend/src/App.test.jsx#L66) | Changing the address switches pages. |

### Integration: sign in to menu: [signin-flow.integration.test.jsx](../frontend/src/signin-flow.integration.test.jsx)

The real App, Login, Menu, cart rules and browser storage working together. Only Supabase, `/api/menu` and `/api/me` are faked.

| Test | What it checks |
|---|---|
| [signs in, opens the menu, and keeps the cart across pages](../frontend/src/signin-flow.integration.test.jsx#L51) | Sign in → the menu opens with "Signed in as …" → an added item is saved → going back to login and browsing again shows the same cart. |
| [stays on the login page when the backend rejects the session](../frontend/src/signin-flow.integration.test.jsx#L71) | If the backend rejects the login, the user stays on the login page and sees the error. |

### Integration: order confirmation and pickup tracking: [order-tracking.integration.test.jsx](../frontend/src/order-tracking.integration.test.jsx)

The real App, Menu, Checkout, OrderPage, MyOrders, cart rules, hash routing and browser storage together (US4, US6). Only Supabase and the FastAPI endpoints are faked, by a small stand-in backend whose stored status a test can change.

| Test | What it checks |
|---|---|
| [opens a confirmation page with the saved order and clears the cart](../frontend/src/order-tracking.integration.test.jsx#L91) | **US4:** placing an order opens `#order/<id>` with its number, items, total and Received status, and empties the cart. |
| [reads the saved order back from the server after a refresh](../frontend/src/order-tracking.integration.test.jsx#L103) | **US4:** a reload re-reads the order from `GET /api/orders/{id}` with the login token. |
| [does not show another student's order when the id in the URL is changed](../frontend/src/order-tracking.integration.test.jsx#L116) | **Failure path:** changing the id in the URL shows "not found", not someone else's order. |
| [returns to an empty cart on the menu](../frontend/src/order-tracking.integration.test.jsx#L128) | **Order something else** goes back to the menu with an empty cart. |
| [shows each new stored status when the student refreshes](../frontend/src/order-tracking.integration.test.jsx#L139) | **US6:** Received → Preparing → Ready for pickup as the stored status changes. |
| [shows the latest status when the order page is opened fresh](../frontend/src/order-tracking.integration.test.jsx#L152) | **US6:** a reload shows the current status, not the one at order time. |
| [keeps the last status visible when the server cannot be reached](../frontend/src/order-tracking.integration.test.jsx#L161) | **Failure path:** a server error keeps the last status and shows the error. |
| [lists the order under My orders and opens it from there](../frontend/src/order-tracking.integration.test.jsx#L171) | **US6:** the order appears under "In progress" with its status, and **View** opens it. |
| [reaches My orders from the menu header](../frontend/src/order-tracking.integration.test.jsx#L185) | The menu header's **My orders** opens the list. |
| [sends a signed-out student to sign in, then back to the same order](../frontend/src/order-tracking.integration.test.jsx#L196) | A guest opening an order link signs in and lands back on that order. |
| [pageFromHash](../frontend/src/order-tracking.integration.test.jsx#L216) ×6 | `#menu`, `#orders` and `#order/<id>` open the right page; anything else is the login page. |

### Contract with the backend: [vite-config.test.js](../frontend/src/vite-config.test.js)

Checks the dev-server settings the frontend needs to reach the backend. A wrong port here broke sign-in during Sprint 2.

| Test | What it checks |
|---|---|
| [targets the backend on port 8001](../frontend/src/vite-config.test.js#L10) | `/api` requests go to `127.0.0.1:8001`, where the backend runs. |
| [strips only the leading /api from request paths](../frontend/src/vite-config.test.js#L14) | `/api/me` becomes `/me`, and only the first `/api` is removed. |
| [reads .env from the repo root, like the backend](../frontend/src/vite-config.test.js#L22) | Both halves share one `.env` file. |
| [only exposes SUPABASE_ variables to the browser](../frontend/src/vite-config.test.js#L27) | Other settings, such as test passwords, never reach the browser. |

## Database: [supabase/tests/menu_items.sql](../supabase/tests/menu_items.sql)

The backend CI job runs this script against the local test database, after `supabase start` has applied [the menu migration](../supabase/migrations/202610120001_menu_items.sql). It checks that the 22 seed items exist (11 counted as entrées), that invalid swipe types are refused, that row-level security is on, and that guests and students can read the menu but not change it. It runs inside a transaction, so nothing is left behind.

## E2E (Playwright)

Location: [frontend/e2e/](../frontend/e2e/). Run with `npm run test:e2e` from `frontend/`. Playwright starts the Vite dev server itself; with a test user set (as in CI, against the local Supabase), it also starts the backend on port 8001. Configuration is in [playwright.config.js](../frontend/playwright.config.js). Each test gets a fresh browser profile, so carts don't carry between tests. [menu-fixture.js](../frontend/e2e/menu-fixture.js) answers the browser's `/api/menu` request with the seed menu, so most journeys don't need the backend or database. The sign-in and full-stack journeys use the real ones.

| Test | What it checks |
|---|---|
| [the app loads on the login page](../frontend/e2e/smoke.spec.js#L4) | The app starts and shows the login page and **Browse menu**. |
| [a student browses the menu, fills a meal swipe, and keeps the cart after a reload](../frontend/e2e/menu-cart.spec.js#L12) | Browse → add an Entry, Side and Drink → each shows 1/1 → reload the page → the cart is still there. |
| [search and category filters narrow the menu and can be reset](../frontend/e2e/menu-cart.spec.js#L35) | A search with no results shows **Reset filters**, which brings back every item. |
| [meal swipes limit each part of the meal and can be raised](../frontend/e2e/swipe-limits.spec.js#L4) | A second Entry is blocked → adding a swipe allows it → swipes can't drop below what's in the cart → clearing the cart frees them. |
| [a guest reviews a full meal and is asked to sign in without losing it](../frontend/e2e/checkout.spec.js#L9) | Build a meal → Review checkout → Validate → asked to sign in → go to login and back → the review and cart are still there. |
| [an incomplete meal cannot be validated and says what is missing](../frontend/e2e/checkout.spec.js#L29) | An Entry alone shows which parts are missing, and Validate is disabled. |
| [a student signs in and lands on the menu](../frontend/e2e/sign-in.spec.js#L8) | A real sign-in through Supabase and the backend opens the menu with "Signed in as …". |
| [a signed-in student builds a meal from the database menu and the server validates it](../frontend/e2e/full-stack.spec.js#L10) | The whole stack with nothing faked: sign in → the 22 menu items load from the database → build a meal → the server confirms it's valid. |
| [a signed-in student places an order and it is saved](../frontend/e2e/full-stack.spec.js#L28) | Sign in → build a meal → validate → **Place order** → "Order received" with the items → back on the menu the cart is empty, also after a reload. |
| [a student places an order, reopens its confirmation, and sees when it is ready for pickup](../frontend/e2e/order-tracking.spec.js#L23) | **US4 + US6, nothing faked:** place an order → confirmation → reload reads it back from the database → the stored status is changed to Preparing, then Ready → **Refresh status** shows each → My orders lists it as Ready for pickup. |
| [a made-up order link shows not found instead of an order](../frontend/e2e/order-tracking.spec.js#L70) | **Failure path:** an order id that isn't the student's shows "We couldn't find that order". |

## Not covered yet

- **Staff status updates (US5):** not built yet. The US4/US6 tests change the status directly in the database, the way staff updates will store it. Staff reading a student's order (US6 allows owner or staff) depends on the staff role US5 adds.
- **The "Sign in with SSO" button,** which has no behavior yet.
- **A network failure when calling `/api/me`.** The page currently shows the browser's raw error text (e.g. "Failed to fetch").

When you add or change a test, update this page too.
