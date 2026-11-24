"""Reconcile country aggregates with freshwater inventories and national checklists."""

# Countries without marine fishing waters in the packaged European area. The Caspian
# coast is intentionally outside this set. A national checklist can confirm exceptions.
INLAND = set("AD AM AT BY CH CZ HU LI LU MD MK RS SK SM VA XK".split())


def apply_checklists(species, checklists):
    """Keep raw GBIF tags for provenance, but publish only supported country memberships."""
    by_name = {fish["latin"]: fish for fish in species}
    for fish in species:
        if fish.get("marine") and not fish.get("river"):
            fish["countries"] = [code for code in fish["countries"] if code not in INLAND]
    for code, checklist in checklists.items():
        for name in checklist["species"]:
            fish = by_name[name]
            if code not in fish["countries"]:
                fish["countries"] = sorted([*fish["countries"], code])
