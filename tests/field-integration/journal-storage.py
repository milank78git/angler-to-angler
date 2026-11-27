"""Restore the private bucket alongside the SQL dump in the disposable integration stack."""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
import uuid

operation, stage = sys.argv[1], Path(sys.argv[2])
settings = json.loads((stage / "local.json").read_bytes())
endpoint = "http://127.0.0.1:54321/storage/v1/object/"
key = settings["SERVICE_ROLE_KEY"]
folder = stage / "journal-objects"


def sql(statement):
    return subprocess.check_output(["psql", settings["DB_URL"], "-XqAt", "-v", "ON_ERROR_STOP=1"],
                                   input=statement, text=True)


def object_request(bucket, method, name, data=None):
    url = endpoint + bucket + "/" + str(uuid.UUID(name))
    request = urllib.request.Request(url, data=data, method=method,
        headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "image/jpeg" if bucket == "angler-catch-photos" else "text/plain"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read()


if operation == "configure":
    # A secret is supplied over stdin to the disposable database, never via process arguments.
    sql("select vault.create_secret('http://supabase_kong_angler-integration:8000/storage/v1','angler_storage_url');"
        + "select vault.create_secret('" + key.replace("'", "''") + "','angler_storage_key');")
elif operation == "backup":
    folder.mkdir(mode=0o700)
    for bucket, table in (("angler-journal","chunks"), ("angler-catch-photos","photos")):
        names = sql(f"select object_id from angler_sync.{table} where object_id is not null").splitlines()
        if not names:
            raise RuntimeError("Expected a private object in " + bucket)
        target = folder / bucket
        target.mkdir(mode=0o700)
        for name in names:
            (target / str(uuid.UUID(name))).write_bytes(object_request(bucket, "GET", name))
elif operation == "restore":
    for target in folder.iterdir():
        for path in target.iterdir():
            object_request(target.name, "POST", path.name, path.read_bytes())
            if object_request(target.name, "GET", path.name) != path.read_bytes():
                raise RuntimeError("Restored journal object differs")
            path.unlink()
        target.rmdir()
    folder.rmdir()
else:
    raise ValueError("Unknown operation")
