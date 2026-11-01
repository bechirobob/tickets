import type { Metadata } from 'next';
import YorkeAudienceTrial from './audience';
import '../trial.css';
import './yorke-trial.css';
export const metadata: Metadata = { title: 'Yorke Way early access · Trial', robots: { index: false, follow: false } };
export default function Page() { return <><YorkeAudienceTrial /></>; }
