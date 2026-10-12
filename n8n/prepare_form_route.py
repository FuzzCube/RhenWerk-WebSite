from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = (root / 'app/api/service-request/route.ts').read_text()
source = source.replace('const webhookUrl = process.env.MAKE_WEBHOOK_URL;', 'const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;\n  const webhookUrl = n8nWebhookUrl || process.env.MAKE_WEBHOOK_URL;')
source = source.replace('The Make webhook is not configured.', 'The service request webhook is not configured.')
source = source.replace('makePayload', 'integrationPayload').replace('makeResponse', 'integrationResponse')
source = source.replace('if (process.env.MAKE_API_KEY)', 'if (!n8nWebhookUrl && process.env.MAKE_API_KEY)')
source = source.replace('Unexpected response from Make.', 'Unexpected response from the service request workflow.')
(Path(__file__).resolve().parent / 'service-request.route.ts').write_text(source)
