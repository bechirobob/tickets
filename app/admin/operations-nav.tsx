"use client";
import type { StaffRole } from "../../lib/admin-session";
import WorkspaceChrome from "../workspace-chrome";
export default function OperationsNav(props: { actor: string; role: StaffRole; active: string }) {
  return <WorkspaceChrome {...props}/>;
}
