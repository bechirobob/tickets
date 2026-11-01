import type { Metadata } from 'next';
import SignupPreview from './signup-preview';
import '../../trial.css';
import '../yorke-trial.css';
export const metadata: Metadata = { title: 'Yorke Way signup preview', robots: { index: false, follow: false } };
export default function Page() { return <><SignupPreview /></>; }
