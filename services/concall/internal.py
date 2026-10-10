"""Same-deployment entrypoint with private, persistent Postgres document storage."""
import contextlib
import json
import os
import sys
import tempfile
from pathlib import Path
from threading import Lock

import psycopg
from psycopg.types.json import Jsonb
from server import app, ResearchRequest, research_documents


_persistent_lock = Lock()


def persistent_research(request):
    with _persistent_lock:
        return _persistent_research(request)


def _persistent_research(request):
    with tempfile.TemporaryDirectory(prefix="tracker-docs-") as temporary:
        os.environ["CONCALL_DATA_DIR"] = temporary
        directory = Path(temporary) / request.bseCode
        directory.mkdir()
        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=15) as connection:
            # Transaction-scoped lock works with Neon's transaction pooler.
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (int(request.bseCode),))
            records = []
            for sha, record, pdf in connection.execute("SELECT sha256, record, pdf FROM valuation.master_tracker_documents WHERE bse_code=%s", (request.bseCode,)):
                path = directory / (sha + ".pdf")
                path.write_bytes(bytes(pdf))
                records.append({**record, "saved_path": str(path)})
            index = directory / "index.jsonl"
            index.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
            with contextlib.redirect_stdout(sys.stderr):
                result = research_documents(request)
            for line in index.read_text(encoding="utf-8").splitlines():
                record = json.loads(line)
                path = Path(record["saved_path"]).resolve()
                if path.is_relative_to(directory.resolve()) and path.is_file() and path.suffix.lower() == ".pdf":
                    connection.execute("INSERT INTO valuation.master_tracker_documents (bse_code,sha256,record,pdf) VALUES (%s,%s,%s,%s) ON CONFLICT (bse_code,sha256) DO UPDATE SET record=EXCLUDED.record,pdf=EXCLUDED.pdf,updated_at=now()", (request.bseCode, record["sha256"], Jsonb(record), path.read_bytes()))
            return result


# Reuse the adapter's authentication/validation while replacing ephemeral storage.
import server
server.research_documents = persistent_research
app.add_api_route("/_internal/concall-research", server.research, methods=["POST"])

if __name__ == "__main__":
    print(json.dumps(persistent_research(ResearchRequest.model_validate_json(sys.stdin.read()))))
