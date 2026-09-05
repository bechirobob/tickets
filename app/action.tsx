import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type ActionAppearance = {
  variant?: "primary" | "secondary" | "text";
  icon?: ReactNode;
};

export function ActionLink({ children, className = "", variant = "primary", icon = <ArrowUpRight size={18} />, ...props }: ComponentProps<typeof Link> & ActionAppearance) {
  return <Link {...props} className={`ticket-action ${className}`} data-variant={variant}>
    <span className="ticket-action__label">{children}</span>
    {icon && <span className="ticket-action__icon" aria-hidden="true">{icon}</span>}
  </Link>;
}

export function ActionButton({ children, className = "", variant = "primary", icon = <ArrowUpRight size={18} />, type = "button", ...props }: ComponentProps<"button"> & ActionAppearance) {
  return <button {...props} type={type} className={`ticket-action ${className}`} data-variant={variant}>
    <span className="ticket-action__label">{children}</span>
    {icon && <span className="ticket-action__icon" aria-hidden="true">{icon}</span>}
  </button>;
}
