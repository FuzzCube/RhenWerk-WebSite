#!/bin/sh
# Wissensbasis des Website-Assistenten neu aufbauen (task-18-10, docs/n8n-workflows.md): Dokumente aus
# n8n/rag-documents in den n8n-Container kopieren (/home/node/.n8n-files, der Ordner, den n8n 2.x lesen darf) und den
# Workflow „RheinWerk · Dokumente importieren“ ausführen (leert rag_documents, schreibt Abschnitte mit Embeddings).
# Nach jeder Änderung an einem Dokument: git pull bzw. Deployment abwarten, dann sh ops/vps/rag-import.sh
set -e
DIR=$(cd "$(dirname "$0")/../.." && pwd)
N8N=${N8N_CONTAINER:-rheinwerk-n8n}
DB=${SUPABASE_DB_CONTAINER:-supabase_db_rheinwerk}

docker exec -u node "$N8N" sh -c 'rm -rf /home/node/.n8n-files/rag-documents && mkdir -p /home/node/.n8n-files/rag-documents'
tar -C "$DIR/n8n/rag-documents" -cf - . | docker exec -i -u node "$N8N" tar -xf - -C /home/node/.n8n-files/rag-documents
echo "$(ls "$DIR"/n8n/rag-documents/*.md | wc -l) Dokumente kopiert"
# Eigener Port für den Task-Broker: der laufende n8n belegt 5679
docker exec -e N8N_RUNNERS_BROKER_PORT=5690 "$N8N" n8n execute --id=rwRagImport2026 > /dev/null
docker exec "$DB" psql -U postgres -Atc "select metadata->>'file', count(*) from public.rag_documents group by 1 order by 1" | sed 's/|/: /; s/$/ Abschnitte/'
