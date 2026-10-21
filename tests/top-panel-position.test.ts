import { describe, expect, it } from 'vitest';
import { topPanelPosition } from '../lib/top-panel-position';

const layout = (overrides: Partial<Parameters<typeof topPanelPosition>[0]> = {}) => topPanelPosition({
  viewport: { top: 0, left: 0, width: 320, height: 740 }, layoutWidth: 320, headerBottom: 64,
  safe: { top: 0, right: 0, bottom: 0, left: 0 }, ...overrides,
});

describe('top-only compact panel geometry', () => {
  it('fits a 320px screen below the header and above the dock', () => {
    const panel = layout({ dockTop: 648 });
    expect(panel).toEqual({ top: 72, right: 12, width: 296, maxHeight: 460 });
    expect(panel.top + panel.maxHeight).toBeLessThan(648);
  });
  it('shrinks in short landscape instead of overlapping the header or navigation', () => {
    const panel = layout({ viewport: { top: 0, left: 0, width: 568, height: 320 }, layoutWidth: 568, dockTop: 232 });
    expect(panel.top).toBe(72); expect(panel.maxHeight).toBe(152);
  });
  it('respects notch and bottom safe areas', () => {
    const panel = layout({ headerBottom: 0, safe: { top: 44, right: 24, bottom: 34, left: 24 }, viewport: { top: 0, left: 0, width: 320, height: 300 } });
    expect(panel).toEqual({ top: 56, right: 24, width: 272, maxHeight: 210 });
  });
  it('tracks the keyboard visual viewport and its offset', () => {
    const panel = layout({ viewport: { top: 80, left: 0, width: 320, height: 210 }, headerBottom: 144, dockTop: 648 });
    expect(panel.top).toBe(152); expect(panel.top + panel.maxHeight).toBe(278);
  });
  it('never forces a panel up over the header if the keyboard leaves no room', () => {
    const panel = layout({ viewport: { top: 0, left: 0, width: 320, height: 70 } });
    expect(panel.top).toBe(72); expect(panel.maxHeight).toBe(0);
  });
  it('does not anchor a notification panel below an in-content trigger', () => {
    const panel = layout({ anchorRight: 100, headerBottom: 64 });
    expect(panel.top).toBe(72); expect(panel.right).toBe(12);
  });
});
