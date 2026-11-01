import type { Metadata } from 'next';
import Trial from './trial';
import './trial.css';

export const metadata: Metadata = { title: 'Guest list · BoardUI trial', robots: { index: false, follow: false } };
export default function BoardUITrialPage() { return <><Trial /></>; }
