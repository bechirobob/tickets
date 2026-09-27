import { requireAdminSession } from "../../lib/admin-auth";
import CurationDesk from "./curation-desk";

export const dynamic = "force-dynamic";

export default async function AdminPage({searchParams}:{searchParams:Promise<{submission?:string}>}) {
  const params = await searchParams;
  const id = typeof params.submission === 'string' && /^[\w-]{1,128}$/.test(params.submission) ? params.submission : undefined;
  const session = await requireAdminSession(`/admin${id ? `?submission=${encodeURIComponent(id)}` : ''}`, "curation.manage");
  return <CurationDesk actor={session.actor} role={session.role} initialSubmissionId={id} />;
}
