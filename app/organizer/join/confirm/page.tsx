import Link from 'next/link';
import BrandLogo from '../../../brand-logo';
import ConfirmApplication from './confirm-application';
import '../join.css';
export const metadata={title:'Confirm your host application · BeCore Tickets',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default function ConfirmPage(){return <main className="host-join"><section className="host-join__window"><header className="host-join__top"><Link href="/" aria-label="BeCore Tickets home"><BrandLogo/></Link><span>For the hosts</span></header><div className="host-join__body"><ConfirmApplication/></div></section></main>;}
