"""Reuse only OAuth client configuration, never another account's login tokens."""
import json
import subprocess
import uuid

remote = "/tmp/rheinwerk-oauth-client-" + uuid.uuid4().hex + ".json"
try:
    result = subprocess.run(["docker", "exec", "n8n", "n8n", "export:credentials", "--id=UiPRJTMgE8NEaiBW", "--decrypted", "--output=" + remote], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("OAuth client export failed; output suppressed")
    data = json.loads(subprocess.run(["docker", "exec", "n8n", "cat", remote], capture_output=True, text=True, check=True).stdout)[0]["data"]
    if isinstance(data, str):
        data = json.loads(data)
    clean = {k: v for k, v in data.items() if k in ("clientId", "clientSecret", "scope", "authUrl", "accessTokenUrl", "authQueryParameters", "authentication")}
    if not clean.get("clientId") or not clean.get("clientSecret"):
        raise RuntimeError("Existing OAuth client configuration is incomplete")
    credential_id = "rw" + uuid.uuid4().hex[:14]
    credentials = [{"id": credential_id, "name": "RheinWerk Gmail", "type": "gmailOAuth2", "data": clean}]
    subprocess.run(["docker", "exec", "-i", "n8n", "sh", "-c", "umask 077; cat > " + remote], input=json.dumps(credentials), capture_output=True, text=True, check=True)
    result = subprocess.run(["docker", "exec", "n8n", "n8n", "import:credentials", "--input=" + remote, "--projectId=tNNYO9peZDHcZ20n"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Credential import failed; secret output suppressed")
    print(json.dumps({"id": credential_id, "name": "RheinWerk Gmail", "login_required": True}))
finally:
    subprocess.run(["docker", "exec", "n8n", "rm", "-f", remote], capture_output=True)
