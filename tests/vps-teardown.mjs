import { afterAll } from 'vitest';
import { closeBindings } from './vps-bindings.mjs';
afterAll(closeBindings);
