import "../../styles/workspace.css";
import "@/components/workspace/workspace.css";
export { staffAppMetadata as metadata } from "../../lib/staff-app-metadata";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <><link id="react-aria-pressable-style" rel="stylesheet" href="/boardui-pressable.css" />{children}</>;
}
