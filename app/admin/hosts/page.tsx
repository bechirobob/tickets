import {requireAdminSession} from '../../../lib/admin-auth';
import HostApplications from './host-applications';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{application?:string}>}){
 const params=await searchParams;
 const id=typeof params.application==='string'&&/^[\w-]{1,128}$/.test(params.application)?params.application:undefined;
 const session=await requireAdminSession(`/admin/hosts${id?`?application=${encodeURIComponent(id)}`:''}`,'accounts.manage');
 return <HostApplications actor={session.actor} role={session.role} initialApplicationId={id}/>;
}
