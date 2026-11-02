import '@/components/workspace/workspace.css';
export { staffAppMetadata as metadata } from "../../../lib/staff-app-metadata";
import type { ReactNode } from 'react';
export default function WorkspaceLayout({children}:{children:ReactNode}) {
  return <><link id="react-aria-pressable-style" rel="stylesheet" href="/boardui-pressable.css" />{children}</>;
}
