"use client";

import { useRouter } from "next/navigation";
import type { StaffRole } from "../../lib/admin-session";
import { STAFF_ROLE_DEFINITIONS, STAFF_WORKSPACE_LINKS } from "../../lib/staff-roles";

export default function WorkspaceJump({ active, role, compact = false }: { active: string; role: StaffRole; compact?: boolean }) {
  const router = useRouter();
  const links: { href: string; label: string }[] = STAFF_WORKSPACE_LINKS
    .filter((item) => (item.roles as readonly StaffRole[]).includes(role))
    .map((item) => ({ href: item.href, label: item.href === "/admin/operations" && role === "finance" ? "Finance overview" : item.label }));

  if (role === "organizer" || role === "owner") links.push({ href: "/organizer/workspace", label: "Organiser workspace" });
  links.push({ href: "/admin/account", label: "My account" });

  return <label className={`workspace-jump${compact ? " workspace-jump--compact" : ""}`}>
    <span>{STAFF_ROLE_DEFINITIONS[role].workspace}</span>
    <select aria-label="Open an authorised workspace" value={active} onChange={(event) => router.push(event.target.value)}>
      {links.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}
    </select>
  </label>;
}
