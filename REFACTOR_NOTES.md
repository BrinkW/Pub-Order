# ICA 14 Pair A refactoring worksheet

Repository: https://github.com/hamayunrz/Pub-Order/tree/ica-14

Scope: Pair A only (base prices, quantity validation, role discounts). Baseline: `fdf0e8b`. Public signature preserved: `calc(t, q, u, d, c=None, w=False)`. Pair B's bulk discount, coupon, waitlist, clamp, fee and rounding code is byte-for-byte unchanged. Existing test expectations are unchanged.

## Worksheet 1 — Understanding

| Question | Verified answer |
| --- | --- |
| What do the parameters mean? | `t`: event type (concert, lecture, sports, workshop); `q`: quantity; `u`: user dictionary or None; `d`: day (0 Monday through 6 Sunday; only 5/6 trigger weekend prices); `c`: coupon or None; `w`: waitlist flag. |
| Discount order; does it matter? | Base price × quantity, role multiplier, $5 bulk discount for q >= 5 except workshops, coupon, $2 waitlist charge, zero clamp, fee band, rounding to 2 decimals. Order matters: 5 lecture tickets for a verified student with HALFOFF cost (25 × .8 - 5) × .5 + 1 = 8.50. |
| Which code can never run? | The initial `p = 0` is a dead assignment: every valid event overwrites it and an invalid event raises. With ordinary valid numeric quantities and the supported user dictionaries, the negative-total clamp cannot trigger: the cheapest bulk subtotal is 5 × 5 × .8 - 5 = 15 before nonnegative coupon multipliers. The clamp is retained in Pair B's code. This is a domain argument, not proof for arbitrary Python objects. |
| Surprising behavior pinned by tests? | FREEDRINK is accepted but changes nothing (`test_freedrink_changes_nothing`). HALFOFF is ignored outside lectures; WELCOME10 requires first_purchase; workshops do not receive the bulk discount. No behavior fixes were made. |

Additional compatibility: quantity validation checks only <= 0 and > 10; it does not enforce integer type. Unknown/missing roles get no discount. Alumni qualify for .85 at years >= 10, otherwise .95. Verified students use .8, unverified students .9, staff .85. Invalid event type is checked before quantity, and quantity before role/coupon processing. The exact ValueError messages remain `bad type`, `bad qty`, `too many`, and `bad coupon`.

## Worksheet 2 — Refactoring log

All steps were AI-assisted with Codex, diff-reviewed, tested, and kept.

| Step | Refactoring | Tests after | Commit | Why kept |
| --- | --- | --- | --- | --- |
| A1 | Extract `base_price(event_type, day)`; name helper parameters; replace temporary assignments with returns | 24 passed | `3beea49` | Isolates event/weekend pricing while preserving comparisons, values, and bad-type errors. |
| A2 | Extract `validate_quantity(quantity)` | 24 passed | `731ec24` | Names the existing bounds; preserves error order/messages without adding validation. |
| A3 | Extract `apply_role_discount(total, user)` | 24 passed | `a80b663` | Isolates role multipliers and leaves unknown/no-user totals untouched; no unnecessary multiply-by-1 operation. |

Pair B's remaining proposed steps are bulk-discount extraction, coupon extraction, and fee extraction. They are suggestions for the other pair, not completed work or verified results. Together with A1–A3 this forms a six-step group plan. No Pair B changes are included here.

## Worksheet 3 — Before and after

Measured with Python 3.12.12, pytest 9.2.0 and radon 6.0.1. “After” is the Pair A-only result, not a merged Pair A + Pair B result.

| Measure | Before | After Pair A |
| --- | --- | --- |
| Highest function CC | calc E (31) | calc C (15) |
| Average CC | 31.0 | 8.5 (B) |
| Number of functions | 1 | 4 |
| Maintainability index | A (53.94) | A (51.88) |
| SLOC | 63 | 69 |
| Characterization tests | 24 / 24 | 24 / 24 |

Helper CC: base_price B (9), validate_quantity A (3), apply_role_discount B (7).

Commands: `.venv312/bin/python -m pytest -q`, `.venv312/bin/radon cc -s -a legacy_pricing.py`, `.venv312/bin/radon mi -s legacy_pricing.py`, `.venv312/bin/radon raw legacy_pricing.py`.

Additional verification: 26,400 combinations compared against baseline `fdf0e8b` (5 event types including invalid, 8 quantities including invalid/fractional/boundary values, 11 user dictionaries/None, 6 days, 5 coupon choices, and 2 waitlist values). Return values or exception types/messages matched in every case. Signature equality and unchanged Pair B tail were also checked. This strengthens characterization coverage but is not a proof over all possible Python inputs.

## Trade-offs and debrief

Extraction makes pricing, validation, and role rules easier to read independently and reduces calc's complexity. It relocates decisions rather than removing business rules: average CC drops partly because there are more functions. SLOC rises from 63 to 69 and MI decreases by 2.06 despite the clearer responsibilities; both MI grades remain A. These metrics should be interpreted alongside the diff and tests.

We retained explicit comparisons rather than introducing a dictionary lookup, preserving existing equality behavior and avoiding a new hashability requirement for event types. The role helper applies discounts to the existing subtotal, preserving the original operation order and untouched totals for unrecognized roles. Future behavior changes (strict integer quantities or changing coupon semantics) require a separate decision and tests.

Human pair membership and eight-minute driver swaps were not recorded by this automated run and are not claimed. Brightspace submission remains for the team; no course submission was made.
