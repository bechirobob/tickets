import Link from 'next/link';
import BrandLogo from '../../brand-logo';
import HostApplicationForm from './host-application-form';
import './join.css';
export const metadata={title:'Become a verified host · BeCore Tickets',description:'Get your host account ready. Your next event can come later.'};
export default function JoinPage(){return <main className="host-join"><section className="host-join__window"><header className="host-join__top"><Link href="/" className="night-brand-link" aria-label="BeCore Tickets home"><BrandLogo/></Link><span>For the hosts</span></header><div className="host-join__body"><HostApplicationForm/></div></section></main>;}
