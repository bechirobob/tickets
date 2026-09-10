import {requireAdminSession} from '../../../lib/admin-auth';
import RegistrationWorkspace from './registration-workspace';
export const dynamic='force-dynamic';
export default async function RegistrationsPage(){const session=await requireAdminSession('/admin/registrations','events.manage');return <RegistrationWorkspace actor={session.actor} role={session.role}/>;}
