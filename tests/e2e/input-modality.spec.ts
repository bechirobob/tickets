import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { buildSync, transformSync } from "esbuild";
import { fileURLToPath } from "node:url";

const policy = transformSync(await readFile(new URL("../../lib/input-modality.ts", import.meta.url), "utf8"), { loader: "ts", format: "iife", globalName: "inputModality" }).code;
async function readCss(url: URL): Promise<string> {
  let text = await readFile(url, "utf8");
  for (const match of [...text.matchAll(/@import "([^"]+)";/g)]) {
    text = text.replace(match[0], await readCss(new URL(match[1], url)));
  }
  return text;
}
const css = (await Promise.all(["../../styles/customer.css", "../../app/workspace.css", "../../app/organizer/organizer.css"].map(path => readCss(new URL(path, import.meta.url))))).join("\n");
const shared = await readFile(new URL("../../styles/input-modality.css", import.meta.url), "utf8");

test("shared pointer focus policy preserves keyboard and editing cues across surfaces", async ({ page }) => {
  await page.setContent(`<style>${css}\n${shared}</style>
    <main>
      <button id="customer">Customer action</button>
      <section class="workspace-topbar"><button id="staff">Staff action</button></section>
      <section class="submission-page"><button id="organizer">Organizer action</button></section>
      <section class="room-page"><div class="chat-action-tray"><button id="reaction">🔥</button></div>
        <div class="chat-message-anchor is-active"><div class="room-bubble">Synthetic message</div></div></section>
      <div tabindex="0" id="scroll">Synthetic scroll region</div>
      <input id="editing" aria-label="Editing"><textarea aria-label="Message" id="message"></textarea>
      <button id="open">Open dialog</button><dialog><button id="close">Close</button></dialog>
    </main>`);
  await page.addScriptTag({ content: policy + ";inputModality.installInputModality(document);" });
  await page.evaluate(() => {
    document.querySelector("#open")!.addEventListener("click", () => (document.querySelector("dialog") as HTMLDialogElement).showModal());
    document.querySelector("#close")!.addEventListener("click", () => (document.querySelector("dialog") as HTMLDialogElement).close());
  });
  const outline = (id: string) => page.locator(id).evaluate(el => getComputedStyle(el).outlineStyle);
  // Programmatic focus after pointer is the affected path, not just native click.
  for (const id of ["#customer", "#staff", "#organizer", "#reaction", "#scroll"]) {
    await page.locator("#customer").dispatchEvent("pointerdown", { pointerType: "touch" });
    await page.locator(id).focus();
    await expect(page.locator(id)).toBeFocused();
    expect(await outline(id)).toBe("none");
    await page.keyboard.press("ArrowRight");
    expect(await outline(id)).not.toBe("none");
  }
  await page.locator("#customer").dispatchEvent("pointerdown", { pointerType: "touch" });
  await page.locator("#editing").focus();
  expect(await outline("#editing")).not.toBe("none");
  await page.locator("#message").focus();
  expect(await outline("#message")).not.toBe("none");
  expect(await page.locator(".room-bubble").evaluate(el => getComputedStyle(el).outlineStyle)).toBe("none");
  await page.locator("#open").click();
  await expect(page.locator("#close")).toBeFocused();
  expect(await outline("#close")).toBe("none");
  await page.keyboard.press("Tab");
  expect(await outline("#close")).not.toBe("none");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  // Scripted zero-detail clicks must not impersonate keyboard/assistive activation.
  await page.locator("#customer").dispatchEvent("pointerdown", { pointerType: "touch" });
  await page.locator("#customer").dispatchEvent("click", { detail: 0 });
  await expect(page.locator("html")).toHaveAttribute("data-input-modality", "pointer");
  await page.locator("#customer").press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-input-modality", "keyboard");
  await page.screenshot({ path: test.info().outputPath("keyboard-focus-preserved.png") });
});

test("real Room toolbar keeps touch quiet and keyboard navigation visible", async ({ page, isMobile }) => {
  const componentPath = fileURLToPath(new URL("../../app/room/[slug]/message-tools.tsx", import.meta.url));
  const bundle = buildSync({
    stdin: { contents: `import React from "react"; import { createRoot } from "react-dom/client";
      import MessageTools from ${JSON.stringify(componentPath)};
      createRoot(document.getElementById("fixture")).render(
        <MessageTools content="Synthetic message" name="Test guest" own={false}
          disabled={false} removed={false} reactions={[]} onReact={()=>{}} onReply={()=>{}}>
          <p>Synthetic message</p>
        </MessageTools>);`,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  }).outputFiles[0].text;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(`<style>${css}\n${shared}</style><main class="room-page" id="fixture"></main>`);
  await page.addScriptTag({ content: policy + ";inputModality.installInputModality(document);" });
  await page.addScriptTag({ content: bundle });
  const trigger = page.getByRole("button", { name: "Actions for Test guest's message" });
  if (isMobile) await trigger.tap(); else await trigger.click();
  const first = page.getByRole("button", { name: "React 🔥", exact: true });
  await expect(first).toBeFocused();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("none");
  expect(await page.locator(".room-bubble").evaluate(el => getComputedStyle(el).outlineStyle)).toBe("none");
  await page.screenshot({ path: test.info().outputPath("room-pointer-actions.png") });
  await page.keyboard.press("ArrowRight");
  const next = page.getByRole("button", { name: "React ❤️", exact: true });
  await expect(next).toBeFocused();
  expect(await next.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("toolbar")).not.toBeVisible();
  await trigger.press("Enter");
  await expect(first).toBeFocused();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
});
