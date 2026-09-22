import Link from 'next/link';
import type {Metadata} from 'next';
import BrandLogo from '../../../brand-logo';
import AcceptInvitation from './accept-invitation';
import '../../../admin/recover/recovery.css';
export const metadata:Metadata={title:'Join the event team · BeCore Tickets',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <main className="admin-login admin-recovery"><section><Link href="/" className="night-brand-link"><BrandLogo/></Link><p className="admin-login__eyebrow">Your event team</p><h1>You’re invited.</h1><AcceptInvitation/></section></main>;}
