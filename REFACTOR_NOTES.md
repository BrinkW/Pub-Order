# ICA 14 — Pair A and Pair B

Branch: https://github.com/hamayunrz/Pub-Order/tree/ica-14

## Worksheet 1

- `t` is the event type, `q` is quantity, `u` is the user dictionary, `d` is the day, `c` is the coupon, and `w` is the waitlist flag.
- Discounts go role discount, bulk discount, then coupon. Order matters because bulk takes off $5 while the others use percentages.
- After the coupon, the $2 waitlist charge is added before the fee band is picked, so it can push an order into a higher fee band.
- The starting `p = 0` is always replaced before it is used. For valid inputs, the total never goes below zero, so the zero clamp does not run.
- The zero fee also never happens: the cheapest valid order (1 lecture, verified student, HALFOFF) is $2 before the fee.
- FREEDRINK is accepted but does nothing. `test_freedrink_changes_nothing` checks this. WELCOME10 without a first purchase and HALFOFF on anything but a lecture are also accepted and do nothing.
- The fee bands use `<`, so a total of exactly 20 pays 2.50 and exactly 100 pays 5.00. The original tests did not check these edges.
- A bad coupon is only rejected after the price is worked out, so a bad quantity plus a bad coupon raises `bad qty`.

## Worksheet 2

| Step | Change | AI or by hand? | Tests after | Kept or reverted? |
| --- | --- | --- | --- | --- |
| A1 | Extract base_price | AI | 24 passed | Kept. Pricing is easier to read. |
| A2 | Extract validate_quantity | AI | 24 passed | Kept. Quantity checks are separate. |
| A3 | Extract apply_role_discount | AI | 24 passed | Kept. Role discounts are easier to follow. |
| B0 | Add 3 tests for fee band edges, waitlist and fee band, and error order | AI | 27 passed | Kept. They passed on the old code first, so they pin existing behavior. |
| B1 | Extract bulk_discount | AI | 27 passed | Kept. The bulk rule is one `if`. |
| B2 | Extract apply_coupon | AI | 27 passed | Kept. Coupons are in one place, called at the same point as before. |
| B3 | Replace fee conditionals with service_fee and a FEE_BANDS table | AI | 27 passed | Kept. Fee bands are one line of data. |
| B4 | Name BULK_MIN_QTY, BULK_DISCOUNT and WAITLIST_FEE | AI | 27 passed | Kept. Rename only. |

Each step was tested and committed. The calc signature and behavior stayed the same, and none of the original 24 tests were changed. We also compared the final code with the original on 26,400 input combinations, including invalid ones, and every result and error matched.

## Worksheet 3

| Measure | Before | After Pair A | After Pair A + B |
| --- | --- | --- | --- |
| Highest CC | E (31) | C (15) | B (9), base_price |
| calc CC | E (31) | C (15) | A (3) |
| Average CC | 31.0 | 8.5 | 5.29 |
| Functions | 1 | 4 | 7 |
| Maintainability | A (53.94) | A (51.88) | A (54.88) |
| SLOC | 63 | 69 | 74 |
| Tests passing | 24/24 | 24/24 | 27/27 |

The code is easier to read, and calc is now just the pricing steps in order. It has more lines because the rules are split into seven functions. Maintainability dipped after Pair A and ended slightly above where it started. The behavior stayed the same; the clamp and zero fee that never run were left in, since removing them would be a behavior change.
