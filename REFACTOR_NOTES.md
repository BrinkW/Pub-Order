# ICA 14 — Pair A

Branch: https://github.com/hamayunrz/Pub-Order/tree/ica-14

## Worksheet 1

- `t` is the event type, `q` is quantity, `u` is the user dictionary, `d` is the day, `c` is the coupon, and `w` is the waitlist flag.
- Discounts go role discount, bulk discount, then coupon. Order matters because bulk takes off $5 while the others use percentages.
- The starting `p = 0` is always replaced before it is used. For valid inputs, the total never goes below zero, so the zero clamp does not run.
- FREEDRINK is accepted but does nothing. `test_freedrink_changes_nothing` checks this.

## Worksheet 2

| Step | Change | AI or by hand? | Tests after | Kept or reverted? |
| --- | --- | --- | --- | --- |
| A1 | Extract base_price | AI | 24 passed | Kept. Pricing is easier to read. |
| A2 | Extract validate_quantity | AI | 24 passed | Kept. Quantity checks are separate. |
| A3 | Extract apply_role_discount | AI | 24 passed | Kept. Role discounts are easier to follow. |

Each step was tested and committed. The calc signature and behavior stayed the same. Pair B's code was not changed.

## Worksheet 3

| Measure | Before | After Pair A |
| --- | --- | --- |
| Highest CC | E (31) | C (15) |
| Average CC | 31.0 | 8.5 |
| Functions | 1 | 4 |
| Maintainability | A (53.94) | A (51.88) |
| SLOC | 63 | 69 |
| Tests passing | 24/24 | 24/24 |

The code is easier to read, but it has a few more lines and the maintainability score went down slightly. The behavior stayed the same.
