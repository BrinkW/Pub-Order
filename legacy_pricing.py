"""Ticket pricing for CampusEvents -- legacy module (ICA 24A).

This works, and it is tested (see test_legacy_pricing.py), but nobody wants to touch it.
Your job: refactor it without changing behavior, and measure the result with radon.
"""


def base_price(event_type, day):
    """Return the ticket price before quantity, discounts, and fees."""
    if event_type == "concert":
        if day == 5 or day == 6:
            return 25.0
        else:
            return 20.0
    elif event_type == "lecture":
        return 5.0
    elif event_type == "sports":
        if day == 5 or day == 6:
            return 15.0
        else:
            return 12.0
    elif event_type == "workshop":
        return 30.0
    else:
        raise ValueError("bad type")


def validate_quantity(quantity):
    """Preserve the legacy quantity bounds and error messages."""
    if quantity <= 0:
        raise ValueError("bad qty")
    if quantity > 10:
        raise ValueError("too many")


def apply_role_discount(total, user):
    """Apply the legacy role multiplier without changing undiscounted totals."""
    if user is not None:
        if user.get("role") == "student":
            if user.get("verified"):
                total = total * 0.8
            else:
                total = total * 0.9
        elif user.get("role") == "staff":
            total = total * 0.85
        elif user.get("role") == "alumni":
            if user.get("years", 0) >= 10:
                total = total * 0.85
            else:
                total = total * 0.95
    return total


def bulk_discount(total, quantity, event_type):
    """Flat $5 off orders of 5 or more tickets, except workshops."""
    if quantity >= 5 and event_type != "workshop":
        return total - 5.0
    return total


def apply_coupon(total, coupon, event_type, user):
    """Apply a coupon code. Unknown codes raise ValueError.

    WELCOME10 without a first purchase and HALFOFF on a non-lecture are accepted but change
    nothing, and FREEDRINK never changes the price (pinned by tests; see REFACTOR_NOTES.md).
    """
    if coupon is None or coupon == "FREEDRINK":
        return total
    if coupon == "WELCOME10":
        first_purchase = user is not None and user.get("first_purchase")
        return total * 0.9 if first_purchase else total
    if coupon == "HALFOFF":
        return total * 0.5 if event_type == "lecture" else total
    raise ValueError("bad coupon")


def calc(t, q, u, d, c=None, w=False):
    # t = event type, q = quantity, u = user dict, d = day of week (0=Mon..6=Sun),
    # c = coupon code, w = waitlist
    p = base_price(t, d)
    validate_quantity(q)
    total = p * q
    total = apply_role_discount(total, u)
    total = bulk_discount(total, q, t)
    total = apply_coupon(total, c, t, u)
    if w:
        total = total + 2.0
    if total < 0:
        total = 0.0
    fee = 0.0
    if total > 0:
        if total < 20:
            fee = 1.0
        elif total < 100:
            fee = 2.5
        else:
            fee = 5.0
    return round(total + fee, 2)
