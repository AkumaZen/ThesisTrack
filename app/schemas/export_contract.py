"""Regenerates contracts/thesis.schema.json from ThesisCreate.

The frontend (P5) validates client-side against this same file, so it must
never drift from the Pydantic model. Run directly, or via
tests/test_contract.py which asserts the checked-in file is current.
"""
import json
from pathlib import Path

from app.schemas.thesis import ThesisCreate

CONTRACT_PATH = Path(__file__).resolve().parent.parent.parent / "contracts" / "thesis.schema.json"


def export() -> dict:
    schema = ThesisCreate.model_json_schema()
    CONTRACT_PATH.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    return schema


if __name__ == "__main__":
    export()
    print(f"wrote {CONTRACT_PATH}")
