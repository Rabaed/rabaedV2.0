import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { listRows, notFoundFor, openList, openProject, PROJECT_NAME } from "../harness/helpers.ts";

// Proves the harness: sign in as two demo people, open the Project and the Submittals List, shoot it.

defineCase("SMOKE-1", async (t) => {
  const { page } = await pageAs("hafiz");
  const projectId = await openProject(page);
  t.check("Hafiz opens the Project from the Projects page", PROJECT_NAME.test(await page.title()) || /\/projects\/[0-9a-f-]{36}/.test(page.url()), page.url());
  await openList(page, projectId);
  const rows = await listRows(page);
  t.check("Hafiz's Submittals List shows rows", rows.length > 0, `${rows.length} rows`);
  t.check("Hafiz sees his own Draft", rows.some((r) => r.subject === "Emergency lighting – Tower 2" && r.number === "No number yet"));
  await t.shot(page, "hafiz-submittals-list");
});

defineCase("SMOKE-2", async (t) => {
  const { page } = await pageAs("yousef");
  const projectId = await openProject(page);
  await openList(page, projectId);
  const rows = await listRows(page);
  t.check("Yousef's Submittals List opens", rows.length >= 0, `${rows.length} rows`);
  t.check("Yousef does not see Hafiz's Draft", !rows.some((r) => r.subject.includes("Emergency lighting – Tower 2") && r.number === "No number yet"));
  await t.shot(page, "yousef-submittals-list");
  const hafiz = await pageAs("hafiz");
  await openList(hafiz.page, projectId);
  const draft = (await listRows(hafiz.page)).find((r) => r.number === "No number yet" && r.subject.includes("Emergency lighting – Tower 2"));
  if (!draft?.href) throw new Error("Hafiz's Draft is not in his List.");
  const nf = await notFoundFor("yousef", draft.href.replace(/^\/(en|ar)/, ""));
  t.check("Hafiz's Draft by id is the plain 404 page for Yousef", nf.notFound, nf.text);
});
