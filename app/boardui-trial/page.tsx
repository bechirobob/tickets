import type { Metadata } from 'next';
import Trial from './trial';
import './trial.css';

export const metadata: Metadata = { title: 'Guest list · BoardUI trial', robots: { index: false, follow: false } };
export default function BoardUITrialPage() { return <><link id="react-aria-pressable-style" rel="stylesheet" href="/boardui-trial-pressable.css" precedence="default" /><Trial /></>; }
