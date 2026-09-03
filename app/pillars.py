"""The 7 standard thesis pillars (+ references), as their exact ThesisData
field names. Shared source of truth for anything that tags data to "which
part of the thesis" - pillar_notes keys (app/schemas/thesis.py) and
custom_tables.section (app/schemas/custom_tables.py). Kept independent from
app/schemas/guidance.py's BlockKey (which predates this and adds "general")
rather than refactoring working code to share it.
"""
PILLAR_KEYS: list[str] = [
    "the_business",
    "the_growth_engine",
    "the_big_change",
    "proof_points",
    "what_can_kill_it",
    "why_we_believe_it",
    "health_check",
    "references",
]
