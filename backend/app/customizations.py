"""Maps a cart's customization ids to the note stored on an order item."""

# Ids the older checkout tests send for a generic burger. A real menu item uses BY_ITEM.
LEGACY = {
    "no-onion": "No onion",
    "no-tomato": "No tomato",
    "no-pickles": "No pickles",
    "no-cheese": "No cheese",
}

BY_ITEM = {
    "beyond-burger-patty": {
        "no-lettuce": "No lettuce",
        "no-tomato": "No tomato",
        "no-onion": "No onion",
        "no-pickles": "No pickles",
        "ketchup": "Ketchup",
    },
    "chicken-sandwich": {
        "no-lettuce": "No lettuce",
        "no-tomato": "No tomato",
        "no-pickles": "No pickles",
        "no-mayo": "No mayo",
        "buffalo": "Buffalo",
        "ranch": "Ranch",
        "honey-mustard": "Honey mustard",
        "bbq": "BBQ",
    },
    "chicken-tenders": {
        "ranch": "Ranch",
        "honey-mustard": "Honey mustard",
        "bbq": "BBQ",
        "buffalo": "Buffalo",
        "ketchup": "Ketchup",
        "sweet-chili": "Sweet chili",
    },
    "fried-cod-with-tartar-sauce": {
        "no-tartar": "No tartar sauce",
        "no-lemon": "No lemon",
        "malt-vinegar": "Malt vinegar",
        "hot-sauce": "Hot sauce",
    },
    "loaded-fries": {
        "no-cheese-sauce": "No cheese sauce",
        "no-sour-cream": "No sour cream",
        "no-green-onion": "No green onions",
        "jalapenos": "Jalapeños",
        "ranch": "Ranch",
    },
    "philly-cheesesteak": {
        "no-onion": "No onion",
        "no-cheese": "No cheese",
        "peppers": "Peppers",
        "mushrooms": "Mushrooms",
        "mayo": "Mayo",
        "hot-sauce": "Hot sauce",
    },
    "pub-burger": {
        "no-lettuce": "No lettuce",
        "no-tomato": "No tomato",
        "no-onion": "No onion",
        "no-pickles": "No pickles",
        "no-cheese": "No cheese",
        "ketchup": "Ketchup",
        "mustard": "Mustard",
        "mayo": "Mayo",
    },
    "seasoned-wings": {
        "ranch": "Ranch",
        "blue-cheese": "Blue cheese",
        "buffalo": "Buffalo",
        "bbq": "BBQ",
        "honey-mustard": "Honey mustard",
    },
}


def customization_text(item_id: str, option_ids: list[str]) -> str:
    phrases = BY_ITEM.get(item_id, LEGACY)
    seen: list[str] = []
    for option_id in option_ids:
        label = phrases.get(option_id)
        if label and label not in seen:
            seen.append(label)
    return ", ".join(seen)
