/**
 * Expand each visible closed disclosure without retaining shifting nth locators.
 * Ported from the reviewed expanded-coverage overlay (run 36932094616).
 * @param {import('@playwright/test').Page} page
 * @param {string} selector A selector matching only closed disclosure summaries.
 */
export async function expandEveryVisibleDisclosure(page, selector = 'details:not([open]) > summary') {
  const opened = [];
  // Re-resolve after each action: :not([open]) shrinks as a summary is clicked.
  for (let attempt = 0; attempt < 150; attempt++) {
    let target;
    for (const summary of await page.locator(selector).all()) {
      if (await summary.isVisible()) { target = summary; break; }
    }
    if (!target) return opened;
    const label = (await target.innerText()).trim();
    await target.click();
    opened.push(label);
  }
  throw new Error('Disclosures did not reach a stable expanded state after 150 actions.');
}
