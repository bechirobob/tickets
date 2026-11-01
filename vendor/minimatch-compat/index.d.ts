export * from '@becoreops/minimatch-engine';
import { minimatch, type MinimatchOptions } from '@becoreops/minimatch-engine';
export declare function makeRe(pattern: string, options?: MinimatchOptions): { test(input: string): boolean };
declare const legacy: typeof minimatch & { makeRe: typeof makeRe };
export default legacy;
