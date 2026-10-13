import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };

// Attachment of an inbox e-mail (task-10-5), streamed with the user's rights like the request documents:
// RLS lets only those who may read the message read the attachment row and the storage object.
export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const session = await getSession();
  if (session.status !== "active") return new NextResponse("Nicht angemeldet.", { status: 401, headers: NO_STORE });

  const { attachmentId } = await params;
  const notFound = new NextResponse("Dokument nicht gefunden.", { status: 404, headers: NO_STORE });
  if (!UUID.test(attachmentId)) return notFound;

  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("attachments")
    .select("bucket, storage_path, file_name, mime_type")
    .eq("id", attachmentId)
    .not("message_id", "is", null)
    .maybeSingle();
  if (!attachment) return notFound;

  const { data: file, error } = await supabase.storage.from(attachment.bucket).download(attachment.storage_path);
  if (error || !file) return notFound;

  return new NextResponse(file.stream(), {
    headers: {
      ...NO_STORE,
      "Content-Type": attachment.mime_type,
      "Content-Length": String(file.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
