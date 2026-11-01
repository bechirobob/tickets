import type { ReactNode } from 'react';
// Shared, external CSP adapter for the pinned React Aria pressable rule.
export default function TrialLayout({ children }: { children: ReactNode }) {
  return <><link id="react-aria-pressable-style" rel="stylesheet" href="/boardui-trial-pressable.css" precedence="default" />{children}</>;
}
