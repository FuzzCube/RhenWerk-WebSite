"""ElevenLabs API key for the call evaluation (task-13-6) without printing it.

Takes ELEVENLABS_API_KEY from .env.local and stores it in n8n as header auth credential "RheinWerk ElevenLabs"
(header xi-api-key). Run again after changing the key; the import replaces the credential with the same id.
The key needs the right to read Agents (Conversational AI) conversations.
"""
import json
import pathlib
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = ROOT / ".env.local"
CREDENTIAL_ID = "rwElevenLabs0001"

value = next((line.split("=", 1)[1] for line in ENV.read_text().splitlines() if line.startswith("ELEVENLABS_API_KEY=")), "")
if not value:
    raise SystemExit("ELEVENLABS_API_KEY fehlt in .env.local.")

data = [{"id": CREDENTIAL_ID, "name": "RheinWerk ElevenLabs", "type": "httpHeaderAuth", "data": {"name": "xi-api-key", "value": value}}]
remote = "/tmp/rheinwerk-credential-" + uuid.uuid4().hex + ".json"
try:
    subprocess.run(["docker", "exec", "-i", "n8n", "sh", "-c", "umask 077; cat > " + remote], input=json.dumps(data), text=True, capture_output=True, check=True)
    imported = subprocess.run(["docker", "exec", "n8n", "n8n", "import:credentials", "--input=" + remote, "--projectId=tNNYO9peZDHcZ20n"], capture_output=True, text=True)
    if imported.returncode:
        raise RuntimeError("Credential import failed; key output suppressed")
    print(json.dumps({"id": CREDENTIAL_ID, "name": data[0]["name"], "type": "httpHeaderAuth", "header": "xi-api-key"}))
finally:
    subprocess.run(["docker", "exec", "n8n", "rm", "-f", remote], capture_output=True)
