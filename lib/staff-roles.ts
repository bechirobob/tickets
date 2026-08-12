export const STAFF_ROLES = ["owner", "curator", "finance", "support", "organizer", "gate", "moderator"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffRoleDefinition = {
  label: string;
  workspace: string;
  summary: string;
  can: readonly string[];
  cannot: readonly string[];
  eventScoped: boolean;
};

export const STAFF_ROLE_DEFINITIONS: Record<StaffRole, StaffRoleDefinition> = {
  owner: {
    label: "Owner",
    workspace: "Full platform",
    summary: "Runs the platform, assigns access and can enter every operational workspace.",
    can: ["Manage people and permissions", "Access every event, finance, support, gate and Room workspace", "Approve high-risk actions requested by someone else"],
    cannot: ["Approve their own cancellation, mass-refund or payout request"],
    eventScoped: false,
  },
  curator: {
    label: "Curator",
    workspace: "Events & curation",
    summary: "Reviews Nights and owns the event record from submission to event-day readiness.",
    can: ["Review submissions and publish Nights", "Manage event details, inventory and promoter links", "Run readiness, incidents and cancellation approvals"],
    cannot: ["Open orders, payments, fees, payouts or customer support", "Manage staff, scan tickets or moderate Rooms"],
    eventScoped: false,
  },
  finance: {
    label: "Finance",
    workspace: "Money operations",
    summary: "Owns payment records and money movement without gaining event or customer-support controls.",
    can: ["Reconcile orders and payments", "Manage refunds, disputes, settlements, payouts and booking fees", "Approve finance actions requested by someone else"],
    cannot: ["Publish or edit events and inventory", "Open customer support, staff, gate or Room workspaces", "Approve event cancellations"],
    eventScoped: false,
  },
  support: {
    label: "Ticket support",
    workspace: "Customer support",
    summary: "Handles order-attached customer conversations without access to wider finance controls.",
    can: ["Read assigned support context and order reference", "Reply to customers and update case status"],
    cannot: ["Search all orders or change payments, refunds, fees, settlements or payouts", "Manage events, staff, gates or Rooms"],
    eventScoped: false,
  },
  organizer: {
    label: "Organiser",
    workspace: "Verified organiser record",
    summary: "Keeps the organiser's submission history and approved Nights together under their verified account email.",
    can: ["See their complete submission trail and all-time event record", "See aggregate sales, attendance, inventory and settlement statements", "Update venue and line-up, post announcements, assign gate staff and send operational requests"],
    cannot: ["See unassigned Nights or customer payment details", "Directly issue refunds, payouts or fee changes", "Enter BeCore curation, finance or staff workspaces"],
    eventScoped: true,
  },
  gate: {
    label: "Gate staff",
    workspace: "Assigned doors",
    summary: "Works the door for explicitly assigned Nights and nothing beyond the entry flow.",
    can: ["Scan and check in tickets", "Use will-call and guest lists for assigned Nights", "See the minimum attendee detail needed to resolve entry"],
    cannot: ["Undo check-ins without owner supervision", "Open sales, finance, support, event editing or other Nights"],
    eventScoped: true,
  },
  moderator: {
    label: "Room moderator",
    workspace: "Assigned Rooms",
    summary: "Keeps the conversation safe inside only the Rooms assigned to their account.",
    can: ["Review reports and remove Room content", "Suspend or restore attendees and publish operational announcements", "Use slow mode and emergency read-only controls"],
    cannot: ["Open orders, payments, fees, ticket scanning or event editing", "Enter Rooms for unassigned Nights"],
    eventScoped: true,
  },
};

export const STAFF_WORKSPACE_LINKS = [
  { href: "/admin/operations", label: "Event operations", roles: ["owner", "curator", "finance"] },
  { href: "/admin", label: "Submission queue", roles: ["owner", "curator"] },
  { href: "/admin/events", label: "Events & inventory", roles: ["owner", "curator"] },
  { href: "/admin/promoters", label: "Promoter links", roles: ["owner", "curator"] },
  { href: "/admin/orders", label: "Orders & payments", roles: ["owner", "finance"] },
  { href: "/admin/support", label: "Ticket support", roles: ["owner", "support"] },
  { href: "/scan", label: "Gate scanner", roles: ["owner", "gate"] },
  { href: "/admin/rooms", label: "Room moderation", roles: ["owner", "moderator"] },
  { href: "/admin/fees", label: "Fees & charges", roles: ["owner", "finance"] },
  { href: "/admin/accounts", label: "People & permissions", roles: ["owner"] },
] as const satisfies readonly { href: string; label: string; roles: readonly StaffRole[] }[];

export function isEventScopedRole(role: StaffRole): boolean {
  return STAFF_ROLE_DEFINITIONS[role].eventScoped;
}

export function isWorkspacePathAllowed(role: StaffRole, path: string): boolean {
  if (path === "/admin/account") return true;
  if (role === "owner" && path === "/organizer/workspace") return true;
  if (role === "organizer") return path === "/organizer/workspace";
  return STAFF_WORKSPACE_LINKS.some((item) => item.href === path && (item.roles as readonly StaffRole[]).includes(role));
}
