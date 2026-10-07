import { expect, test } from "@playwright/test";
import { people, signedIn } from "./demo.ts";

// UAT case (spike): the Consultant Manager issues Code C on a submitted MAR, with the
// Consultant verification and Remarks; then what each Company sees (visibility.md V1, V14).
// Uses the seeded "Cable tray risers – Tower 1" Rev 1, waiting with Design Consultants LLC:
// it runs once per demo seed (reset with `pnpm demo` to run it again).
const SUBJECT = "Cable tray risers – Tower 1";
const NUMBER = "TWR-MAR-01-0003 Rev 1";
const REMARKS = "Trays still electro-zinc plated; resubmit with hot dip galvanised (EN ISO 1461).";
const NOTE = "Sample checked on site: coating is electro-zinc, not hot dip galvanised.";

test("Consultant issues Code C with Remarks; each Company sees only what it may", async ({ browser }) => {
  let itemUrl = "";

  await test.step("Mohammed (Consultant Manager) opens the MAR from Submittals", async () => {
    const page = await signedIn(browser, people.mohammed);
    await page.getByRole("link", { name: /Riyadh Gate Tower/ }).first().click();
    await page.getByRole("link", { name: "Submittals" }).first().click();
    await page.getByRole("link", { name: new RegExp(SUBJECT) }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: SUBJECT })).toBeVisible();
    await expect(page.getByText(NUMBER).first()).toBeVisible();
    await expect(page.getByText("Pending Approval").first()).toBeVisible();
    itemUrl = new URL(page.url()).pathname;

    await test.step("Claim the Consultant review Step", async () => {
      await page.getByRole("region", { name: "Transitions" }).getByRole("button", { name: "Claim" }).click();
      await expect(page.getByRole("region", { name: "Transitions" }).getByRole("button", { name: /Revise & Resubmit · C/ })).toBeVisible();
    });

    await test.step("Fill in the Consultant verification and save it", async () => {
      const verification = page.getByRole("region", { name: "Consultant verification" });
      await verification.getByRole("radiogroup", { name: "Sample checked" }).getByRole("radio", { name: "Yes" }).check();
      await verification.getByRole("radiogroup", { name: "Matches specification" }).getByRole("radio", { name: "No" }).check();
      await verification.getByRole("textbox", { name: "Verification note" }).fill(NOTE);
      await page.getByRole("button", { name: "Save Draft" }).click();
      await expect(page.getByText(/saved/i).first()).toBeVisible();
    });

    await test.step("Issue Revise & Resubmit · C with Remarks", async () => {
      await page.getByRole("region", { name: "Transitions" }).getByRole("button", { name: /Revise & Resubmit · C/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("textbox", { name: "Remarks" }).fill(REMARKS);
      await dialog.getByRole("button", { name: /Revise & Resubmit · C/ }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Revise & Resubmit").first()).toBeVisible();
      await expect(page.getByText(REMARKS).first()).toBeVisible();
    });
    await page.context().close();
  });

  await test.step("Hafiz (TMC, the raiser) sees Code C, the Remarks and the verification; of the Consultant, only its name and the Code's signer (V14)", async () => {
    const page = await signedIn(browser, people.hafiz);
    await page.goto(itemUrl);
    await expect(page.getByRole("heading", { level: 1, name: SUBJECT })).toBeVisible();
    await expect(page.getByText("Revise & Resubmit").first()).toBeVisible();
    await expect(page.getByText(REMARKS).first()).toBeVisible();
    await expect(page.getByText(NOTE).first()).toBeVisible();
    await expect(page.getByText("Design Consultants LLC").first()).toBeVisible();
    // The one person of another Company named is the signer of the final Code, once, on that event.
    const signer = page.getByText("Mohammed Al Shamsi");
    await expect(signer).toHaveCount(1);
    await expect(signer).toContainText("Revise & Resubmit");
    // Nobody else of the Consultant, and none of its internal moves (its Claim).
    await expect(page.getByText(/Ahmed bin Said|Sara\b/)).toHaveCount(0);
    // TMC sees its own internal Claim (Ali's), never the Consultant's.
    await expect(page.getByRole("listitem").filter({ hasText: "Design Consultants LLC" }).filter({ hasText: "Claimed" })).toHaveCount(0);
    await page.context().close();
  });

  await test.step("Yousef (Beta Build, another Contractor) cannot open it: 404, naming nothing", async () => {
    const page = await signedIn(browser, people.yousef);
    const response = await page.goto(itemUrl);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(SUBJECT)).toHaveCount(0);
    await expect(page.getByText(NUMBER)).toHaveCount(0);
    await page.context().close();
  });
});
