import type {Metadata} from 'next';
import PromoterPortal from './promoter-portal';
import '../organizer/workspace/suite.css';
export const metadata:Metadata={title:'Your promoter report · BeCore Tickets',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <PromoterPortal/>;}
