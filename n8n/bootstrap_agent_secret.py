"""Shared secret of the voice agent's webhooks (task-13-5) without printing it.

Takes AGENT_WEBHOOK_SECRET from .env.local or creates one there, and stores it in n8n as header auth credential
"RheinWerk Agent-Secret" (header x-agent-secret). Run again after changing the value; the import replaces the
credential with the same id.
"""
import json
import pathlib
import secrets
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = ROOT / ".env.local"
CREDENTIAL_ID = "rwAgentSecret001"

lines = ENV.read_text().splitlines()
value = next((line.split("=", 1)[1] for line in lines if line.startswith("AGENT_WEBHOOK_SECRET=")), "")
if not value:
    value = secrets.token_urlsafe(32)
    lines = [line for line in lines if not line.startswith("AGENT_WEBHOOK_SECRET=")] + ["AGENT_WEBHOOK_SECRET=" + value]
    ENV.write_text("\n".join(lines) + "\n")

data = [{"id": CREDENTIAL_ID, "name": "RheinWerk Agent-Secret", "type": "httpHeaderAuth", "data": {"name": "x-agent-secret", "value": value}}]
remote = "/tmp/rheinwerk-credential-" + uuid.uuid4().hex + ".json"
try:
    subprocess.run(["docker", "exec", "-i", "n8n", "sh", "-c", "umask 077; cat > " + remote], input=json.dumps(data), text=True, capture_output=True, check=True)
    imported = subprocess.run(["docker", "exec", "n8n", "n8n", "import:credentials", "--input=" + remote, "--projectId=tNNYO9peZDHcZ20n"], capture_output=True, text=True)
    if imported.returncode:
        raise RuntimeError("Credential import failed; secret output suppressed")
    print(json.dumps({"id": CREDENTIAL_ID, "name": data[0]["name"], "type": "httpHeaderAuth", "header": "x-agent-secret"}))
finally:
    subprocess.run(["docker", "exec", "n8n", "rm", "-f", remote], capture_output=True)
