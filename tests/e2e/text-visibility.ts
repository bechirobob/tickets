import { expect, type Page } from "@playwright/test";

/** Inspect painted text ranges, including letters clipped by an ancestor. */
export async function expectVisibleLettering(page: Page, rootSelector: string) {
  const clipped = await page.locator(rootSelector).evaluateAll((roots) => {
    const issues: string[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const content = node.textContent?.trim();
        if (!content || node.parentElement?.closest(".sr-only, script, style")) continue;
        const closedDetails = node.parentElement?.closest("details:not([open])");
        if (closedDetails && !closedDetails.querySelector("summary")?.contains(node)) continue;
        const ancestors: HTMLElement[] = [];
        let visible = true;
        for (let element = node.parentElement; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) { visible = false; break; }
          ancestors.push(element);
        }
        if (!visible) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          if (rect.left < -2 || rect.right > document.documentElement.clientWidth + 2) {
            issues.push(`Outside page: ${content}`);
          }
          for (const ancestor of ancestors) {
            const style = getComputedStyle(ancestor);
            const bounds = ancestor.getBoundingClientRect();
            if (["hidden", "clip"].includes(style.overflowX) && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)) issues.push(`Clipped horizontally: ${content}`);
            if (["hidden", "clip"].includes(style.overflowY) && (rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) issues.push(`Clipped vertically: ${content}`);
          }
        }
      }
    }
    return [...new Set(issues)];
  });
  expect(clipped).toEqual([]);
}
