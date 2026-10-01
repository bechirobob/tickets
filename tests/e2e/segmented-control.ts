import { expect, type Locator } from "@playwright/test";

/** Verify the real, final cascade and indicator after a caller changes its view. */
export async function expectSegmentedSelection(control: Locator) {
  await expect(control).toHaveClass(/segmented-control/);
  await expect(control).toHaveAttribute("data-measured", "true");
  const selected = control.locator(':scope > button[aria-current="page"], :scope > button[aria-pressed="true"]');
  await expect(selected).toHaveCount(1);
  const indicator = control.locator(":scope > .segmented-control__selection");
  await expect(indicator).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => {
    const target = await selected.boundingBox();
    const marker = await indicator.boundingBox();
    if (!target || !marker) return false;
    return ["x", "y", "width", "height"].every(key => Math.abs(target[key as keyof typeof target] - marker[key as keyof typeof marker]) <= 1);
  }).toBe(true);
  const issues = await control.evaluate(root => {
    const problems: string[] = [];
    if (root.scrollWidth > root.clientWidth + 1) problems.push("The selector overflows horizontally");
    for (const element of root.querySelectorAll(":scope > button, :scope > a")) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width < 44 || box.height < 44) problems.push(`${element.textContent}: touch target is smaller than 44px`);
      if (style.borderBottomWidth !== "0px" || style.boxShadow !== "none" || style.textShadow !== "none") problems.push(`${element.textContent}: legacy underline or shadow remains`);
      // Include wrapped text and count badges, but ignore labels deliberately
      // absent from layout at a breakpoint. Every visible glyph must fit.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const text of range.getClientRects()) if (text.width && (text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1)) problems.push(`${element.textContent}: label is clipped`);
      }
    }
    return problems;
  });
  expect(issues).toEqual([]);
}
