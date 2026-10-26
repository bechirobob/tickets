import type { ReactNode } from 'react';
import './yorke-way.css';

export default function YorkeWayLayout({ children }: { children: ReactNode }) {
  return <div className="yorke-way">{children}</div>;
}
