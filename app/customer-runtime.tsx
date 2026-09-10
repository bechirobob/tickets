"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Platform actions only. Screens, copy, styles and catalogue remain shared. */
type CustomerRuntime = {
  openSecurePage?: (path: string) => Promise<void>;
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  stale?: boolean;
};
const Runtime = createContext<CustomerRuntime>({});
export const useCustomerRuntime = () => useContext(Runtime);
export function CustomerRuntimeProvider({ value, children }: { value: CustomerRuntime; children: ReactNode }) {
  return <Runtime.Provider value={value}>{children}</Runtime.Provider>;
}
