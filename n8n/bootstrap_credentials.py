"""Create a dedicated local Supabase credential without printing its secret."""
import json
import pathlib
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
status = subprocess.run(["supabase", "status", "-o", "json"], cwd=ROOT, capture_output=True, text=True, check=True)
values = json.loads(status.stdout)
credential_id = "rw" + uuid.uuid4().hex[:14]
data = [{"id": credential_id, "name": "RheinWerk Supabase Lokal", "type": "supabaseApi", "data": {"host": "http://kong:8000", "serviceRole": values["SERVICE_ROLE_KEY"]}}]
remote = "/tmp/rheinwerk-credential-" + uuid.uuid4().hex + ".json"
try:
    subprocess.run(["docker", "exec", "-i", "n8n", "sh", "-c", "umask 077; cat > " + remote], input=json.dumps(data), text=True, capture_output=True, check=True)
    imported = subprocess.run(["docker", "exec", "n8n", "n8n", "import:credentials", "--input=" + remote, "--projectId=tNNYO9peZDHcZ20n"], capture_output=True, text=True)
    if imported.returncode:
        raise RuntimeError("Credential import failed; secret output suppressed")
    print(json.dumps({"id": credential_id, "name": data[0]["name"], "type": "supabaseApi", "host": data[0]["data"]["host"]}))
finally:
    subprocess.run(["docker", "exec", "n8n", "rm", "-f", remote], capture_output=True)
