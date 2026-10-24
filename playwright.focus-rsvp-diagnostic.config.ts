import { defineConfig } from '@playwright/test';
import base from './playwright.registration.config';
export default defineConfig({ ...base, testMatch: 'focus-rsvp-diagnostic.spec.ts', use: {...base.use, trace: 'on'} });
