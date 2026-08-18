import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowsDirectory = new URL("../.github/workflows/", import.meta.url);

test("Tickets automation remains scoped to the Tickets product", async () => {
  const workflowNames = (await readdir(workflowsDirectory)).filter((name) =>
    /\.ya?ml$/u.test(name),
  );
  const workflows = await Promise.all(
    workflowNames.map(async (name) => ({
      name,
      source: await readFile(new URL(name, workflowsDirectory), "utf8"),
    })),
  );

  for (const workflow of workflows) {
    assert.doesNotMatch(
      workflow.source,
      /bubble[ -]?wash|bubblewash\.co|address\.becoreops\.com|custom-domains\.chatgpt\.site/iu,
      `${workflow.name} must not operate another product or domain`,
    );
    for (const actionReference of workflow.source.matchAll(/uses:\s*([^\s#]+)/gu)) {
      const reference = actionReference[1];
      if (reference.startsWith("./") || reference.startsWith("docker://")) continue;
      assert.match(
        reference,
        /^[^@\s]+@[a-f0-9]{40}$/u,
        `${workflow.name} must pin ${reference} to an immutable commit SHA`,
      );
    }
  }
});
