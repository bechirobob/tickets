import {requireAdminSession} from '../../../lib/admin-auth';
import HostApplications from './host-applications';
export const dynamic='force-dynamic';
export default async function Page(){const session=await requireAdminSession('/admin/hosts','accounts.manage');return <HostApplications actor={session.actor} role={session.role}/>;}
