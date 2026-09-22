import { requireAdminSession } from "../../../lib/admin-auth";
import OperationsNav from "../operations-nav";
import HelpCentre from "../../help/help-centre";
export const dynamic = "force-dynamic";
export default async function WorkspaceHelpPage() {
  const session = await requireAdminSession("/admin/help");
  return <main className="ops-page"><OperationsNav actor={session.actor} role={session.role} active="/admin/help"/><section className="ops-main"><HelpCentre workspace/></section></main>;
}
