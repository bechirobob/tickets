import type { CSSProperties } from "react";
import { eventPresentationVariables } from "./event-palette";
export { eventColourSchemes, isEventColourScheme, eventColourScheme } from "./event-palette";
export type { EventColourScheme } from "./event-palette";

export function eventPresentationStyle(event: Parameters<typeof eventPresentationVariables>[0]): CSSProperties {
  return eventPresentationVariables(event) as CSSProperties;
}
