import type { Metadata } from 'next';
import WorkspaceTrial from './workspace';
import '../trial.css';
import '../yorke-way/yorke-trial.css';
import './workspace.css';
export const metadata: Metadata = { title: 'Workspace trial · BeCore Tickets', robots: { index: false, follow: false } };
export default function Page() { return <><WorkspaceTrial /></>; }
