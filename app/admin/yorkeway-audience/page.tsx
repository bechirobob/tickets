import { redirect } from 'next/navigation';
import { requireAdminSession } from '../../../lib/admin-auth';
import YorkewayAudience from './yorkeway-audience';
export const dynamic = 'force-dynamic';
export default async function YorkewayAudiencePage() {
  const session = await requireAdminSession('/admin/yorkeway-audience', 'accounts.manage');
  if (session.role !== 'owner') redirect('/admin/account');
  return <YorkewayAudience actor={session.actor} role={session.role} />;
}
