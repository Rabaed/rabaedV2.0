import type { Page } from "playwright";
import { pageAs, urlOf, webUrl } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, go, openProject, settle } from "../harness/helpers.ts";
import { ARABIC_INDIC, emailOf, mailsAbout, marContext, recordPdf, pdfPages, tracker } from "../harness/helpers-not.ts";

// Part I18N: Arabic and English, RTL, Latin digits, Document Numbers left to right, phone width 375,
// desktop widths, and the not-found page.

const stamp = () => new Date().toISOString().slice(11, 19).replaceAll(":", "");

/** Items the signed-in person lists in the Project: id, number, title, stage. */
async function items(api: Api, projectId: string, query = ""): Promise<{ id: string; documentNumber: string | null; title: string; revisionNo: number; stage: { key: string } }[]> {
  return ((await api.get(`/projects/${projectId}/work-items${query}`)).body as { items: { id: string; documentNumber: string | null; title: string; revisionNo: number; stage: { key: string } }[] }).items;
}

/** A closed (Code A) item the person sees. */
async function closedItem(api: Api, projectId: string) {
  const a = await items(api, projectId, "?type=MAR&bucket=A");
  const hit = a.find((i) => i.documentNumber === "TWR-MAR-01-0001") ?? a[0];
  if (!hit) throw new Error("No closed Code A item visible.");
  return hit;
}

const overflowOf = (page: Page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, dir: document.documentElement.dir, lang: document.documentElement.lang }));

/** Opens the person menu and picks the other language, as a Member does. Returns once the new locale is loaded. */
async function switchLanguage(page: Page, to: "ar" | "en", nameRe: RegExp): Promise<void> {
  await page.getByRole("button").filter({ hasText: nameRe }).last().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText(to === "ar" ? /^العربية$/ : /^English$/).first().click();
  await page.waitForURL(new RegExp(`/${to}(/|$|\\?)`));
  await settle(page, 800);
}

/** Left edge of the first and last Kanban column headings, in document order. */
async function columnEdges(page: Page): Promise<[number, number] | null> {
  await page.getByRole("main").locator("h2").nth(1).waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const xs = await page.getByRole("main").locator("h2").evaluateAll((hs) => hs.map((h) => Math.round(h.getBoundingClientRect().x + h.getBoundingClientRect().width / 2)));
  if (xs.length < 2) {
    const nf = (await page.getByTestId("not-found").count()) > 0;
    throw new Error(nf ? "The Kanban showed the not-found page although the api answers 200 for the same Member (lane problem, not the mirror check)." : "The Kanban showed fewer than two columns.");
  }
  return [xs[0]!, xs[xs.length - 1]!];
}

// -------------------------------------------------------------------------------------------------

defineCase("I18N-01", async (t) => {
  const c = tracker(t);
  const hafiz = await Api.as("hafiz");
  const { projectId } = await marContext(hafiz);
  const rows = await items(hafiz, projectId);
  const some = rows.find((r) => r.documentNumber === "TWR-MAR-01-0002") ?? rows.find((r) => r.documentNumber);
  const itemPath = `/work-items/${some!.id}`;
  const places: [string, string][] = [
    ["Home", "/"],
    ["List", `/projects/${projectId}/work-items`],
    ["Kanban", `/projects/${projectId}/work-items?view=kanban`],
    ["item", itemPath],
  ];
  const { page } = await pageAs("hafiz", { locale: "en" });
  for (const [name, path] of places) {
    await go(page, path, "en");
    await settle(page);
    const en = await overflowOf(page);
    const urlEn = new URL(page.url());
    await switchLanguage(page, "ar", /Hafiz Hamdan/);
    const ar = await overflowOf(page);
    const urlAr = new URL(page.url());
    c.check(`${name}: the language button reloads the same page in Arabic`, urlAr.pathname === urlEn.pathname.replace(/^\/en/, "/ar") && urlAr.search === urlEn.search, `${urlEn.pathname}${urlEn.search} -> ${urlAr.pathname}${urlAr.search}`);
    c.check(`${name}: it is right to left (dir=rtl, lang=ar)`, ar.dir === "rtl" && ar.lang === "ar", `${ar.dir}/${ar.lang}`);
    c.check(`${name}: English is left to right`, en.dir === "ltr" && en.lang === "en", `${en.dir}/${en.lang}`);
    c.check(`${name}: nothing scrolls sideways in either language`, en.scroll <= en.inner + 1 && ar.scroll <= ar.inner + 1, `en ${en.scroll}/${en.inner}, ar ${ar.scroll}/${ar.inner}`);
    const side = await page.locator("nav").first().boundingBox();
    const vw = ar.inner;
    if (name === "Home") {
      c.check("Home: the sidebar sits on the right in Arabic", !!side && side.x + side.width / 2 > vw / 2, `sidebar centre ${side ? Math.round(side.x + side.width / 2) : "?"} of ${vw}`);
      await t.shot(page, "home-ar");
    }
    if (name === "Kanban") {
      if ((await page.getByTestId("not-found").count()) > 0) t.note("Hafiz's Kanban showed the not-found page although the api answers 200 (3-4 s, 680 KB): a lane problem noted in the report; the column order is checked as Faisal below.");
      await t.shot(page, "kanban-ar");
    }
    if (name === "List") {
      const dirs = await page.getByRole("table").first().evaluate((el) => getComputedStyle(el).direction);
      c.check("List: the table is right to left in Arabic", dirs === "rtl", dirs);
      await t.shot(page, "list-ar");
    }
    await switchLanguage(page, "en", /حافظ حمدان/);
    c.check(`${name}: the switch back returns to the same page in English`, new URL(page.url()).pathname === urlEn.pathname && new URL(page.url()).search === urlEn.search, page.url());
    await go(page, path, "ar"); // directly
    const direct = await overflowOf(page);
    c.check(`${name}: opening /ar directly gives the same RTL page`, direct.dir === "rtl" && direct.scroll <= direct.inner + 1, `${direct.dir} ${direct.scroll}/${direct.inner}`);
  }
  // Kanban column order, as Faisal (Arabic first).
  const fk = await pageAs("faisal", { locale: "ar" });
  await go(fk.page, `/projects/${projectId}/work-items?view=kanban`, "ar");
  await settle(fk.page, 800);
  const kAr = await columnEdges(fk.page);
  await switchLanguage(fk.page, "en", /فيصل العتيبي/);
  const kEn = await columnEdges(fk.page);
  c.check("Kanban: the column order mirrors (first column on the left in English, on the right in Arabic)", kEn[0] < kEn[1] && kAr[0] > kAr[1], `en ${kEn}, ar ${kAr}`);
  // Faisal's side: an Arabic first user switches the other way on Home.
  const fa = await pageAs("faisal", { locale: "ar" });
  await go(fa.page, "/", "ar");
  await settle(fa.page);
  await switchLanguage(fa.page, "en", /فيصل العتيبي/);
  c.check("Faisal: Arabic to English on Home keeps the page and is left to right", new URL(fa.page.url()).pathname === "/en" && (await overflowOf(fa.page)).dir === "ltr", fa.page.url());
  await t.shot(fa.page, "faisal-home-en");
  t.note("Arrows and breadcrumbs mirroring and 'nothing cut off' are judged from the screenshots (home-ar, list-ar, kanban-ar); the script checks direction, sidebar side, column order and sideways scroll.");
});

// -------------------------------------------------------------------------------------------------

defineCase("I18N-02", async (t) => {
  const c = tracker(t);
  const hafiz = await Api.as("hafiz");
  const { projectId } = await marContext(hafiz);
  const { page } = await pageAs("faisal", { locale: "ar" });
  const faisal = await Api.as("faisal");
  const fi = await items(faisal, projectId);
  const closed = await closedItem(faisal, projectId);
  const any = fi.find((i) => i.documentNumber) ?? fi[0]!;
  const pages: [string, string][] = [
    ["Home", "/"],
    ["Notifications", "/notifications"],
    ["Projects", "/projects"],
    ["Dashboard", `/projects/${projectId}`],
    ["Submittals List", `/projects/${projectId}/work-items`],
    ["Kanban", `/projects/${projectId}/work-items?view=kanban`],
    ["Activity", `/projects/${projectId}/activity`],
    ["a closed item", `/work-items/${closed.id}`],
    ["an item", `/work-items/${any.id}`],
  ];
  for (const [name, path] of pages) {
    await go(page, path, "ar");
    await settle(page, 600);
    const text = await page.locator("body").innerText();
    const digits = text.match(ARABIC_INDIC);
    c.check(`${name} (Arabic): Latin digits only`, !digits, digits ? `found ${digits[0]} in: ${text.slice(Math.max(0, text.search(ARABIC_INDIC) - 30), text.search(ARABIC_INDIC) + 30)}` : undefined);
    const hasDigits = /[0-9]/.test(text);
    if (name === "Dashboard") c.check("Dashboard: figures are shown in Latin digits", hasDigits && !ARABIC_INDIC.test(text));
    if (name === "Dashboard") await t.shot(page, "dashboard-ar");
  }
  // Times are Riyadh time: a notification's shown time against its own instant.
  await go(page, "/notifications", "ar");
  await settle(page);
  const entry = await page.getByRole("main").locator("li time").first().evaluate((el) => ({ at: el.getAttribute("datetime"), text: el.textContent ?? "" }));
  const riyadh = new Date(entry.at!).toLocaleString("en-US", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit", hour12: true });
  const hm = riyadh.replace(/\s?(AM|PM)/, "");
  c.check("a time is shown in Riyadh time, a date is Gregorian", entry.text.includes(hm) && /2026/.test(entry.text) && /\/(9|10|11)\//.test(entry.text.replace(/[\u200E\u200F]/g, "")), `${entry.text} for ${entry.at} (Riyadh ${riyadh})`);
  await t.shot(page, "notifications-ar");
  // An Arabic email.
  const arMail = (await mailsAbout(emailOf.faisal!, "UAT")).find((m) => /[؀-ۿ]/.test(m.text));
  if (arMail) c.check("an Arabic email of Faisal (from NOT-10) has Latin digits only", !ARABIC_INDIC.test(arMail.subject + arMail.text + arMail.html), arMail.subject);
  else t.note("No Arabic email of Faisal in Mailpit yet (NOT-10 makes one): the email check was skipped.");
  // The PDF of a closed item Faisal sees.
  const rec = await recordPdf(faisal, closed.id);
  if (rec.status === 200) {
    const text = (await pdfPages(rec.bytes)).join(" ");
    c.check("the record PDF has Latin digits only", !ARABIC_INDIC.test(text), `${text.length} characters read`);
  } else t.note(`No record PDF for the closed item (link ${rec.linkStatus}): the PDF check was skipped.`);
});

// -------------------------------------------------------------------------------------------------

/** In the page: every visible Document Number (with Rev) and whether it reads left to right whole. */
const scanNumbers = (page: Page) =>
  page.evaluate(() => {
    const re = /TWR-[A-Z]{3}-\d{2}-\d{4}(?: Rev \d+)?/;
    const bad: string[] = [];
    let found = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = re.exec(n.nodeValue ?? "");
      const el = n.parentElement;
      if (!m || !el || el.closest("script,style,noscript,template")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      found++;
      const cs = getComputedStyle(el);
      const isolated = cs.direction === "ltr" && ["isolate", "embed", "bidi-override", "isolate-override"].includes(cs.unicodeBidi);
      const bdi = el.closest("bdi");
      const alone = (el.textContent ?? "").trim() === m[0] && cs.direction === "ltr";
      const bdiOk = !!bdi && getComputedStyle(bdi).direction === "ltr" && (bdi.textContent ?? "").trim().startsWith("TWR-");
      if (!(isolated || bdiOk || alone)) bad.push(`${(el.textContent ?? "").trim().slice(0, 60)} <${el.tagName.toLowerCase()} dir=${cs.direction} bidi=${cs.unicodeBidi}>`);
    }
    return { found, bad };
  });

defineCase("I18N-03", async (t) => {
  const c = tracker(t);
  const hafiz = await Api.as("hafiz");
  const { projectId } = await marContext(hafiz);
  const faisal = await Api.as("faisal");
  const fi = await items(faisal, projectId);
  const withLinks = fi.find((i) => i.documentNumber === "TWR-MAR-01-0002");
  const rev = fi.find((i) => i.revisionNo > 0 && i.documentNumber);
  const { page } = await pageAs("faisal", { locale: "ar" });
  const check = async (name: string, path: string, mayBeEmpty = false) => {
    await go(page, path, "ar");
    await settle(page, 700);
    const r = await scanNumbers(page);
    c.check(`${name}: Document Numbers read left to right whole`, (r.found > 0 || mayBeEmpty) && r.bad.length === 0, `${r.found} found; not isolated: ${r.bad.slice(0, 3).join(" | ")}`);
    return r;
  };
  await check("Home", "/", true);
  await check("List", `/projects/${projectId}/work-items`);
  await t.shot(page, "list-ar");
  if (withLinks) {
    await check("an item with Links", `/work-items/${withLinks.id}`);
    await t.shot(page, "item-links-ar");
  } else t.note("TWR-MAR-01-0002 (links to 0001) is not in Faisal's List: the Link check used another item.");
  if (rev) {
    await check("a Revision (Rev n, with its Revision drop-down)", `/work-items/${rev.id}`);
    await t.shot(page, "revision-ar");
  } else t.note("No Revision visible to Faisal: the Revision check was skipped.");
  await check("Notifications", "/notifications");
  const closed = await closedItem(faisal, projectId);
  const rec = await recordPdf(faisal, closed.id);
  if (rec.status === 200) {
    const pages = await pdfPages(rec.bytes);
    const joined = pages.join(" ");
    c.check("the record PDF carries the Document Number whole (TWR-MAR-01-nnnn in one piece)", /TWR-MAR-01-\d{4}/.test(joined), joined.slice(0, 120));
  }
  t.note("The PDF's left-to-right order is read from the extracted text (number in one piece); how it sits inside Arabic lines is for the eye (see SIG-03).");
});

// -------------------------------------------------------------------------------------------------

defineCase("I18N-04", async (t) => {
  const c = tracker(t);
  const hafiz = await Api.as("hafiz");
  const ctx = await marContext(hafiz);
  const title = `UAT I18N-04 empty ${stamp()}`;
  const res = await hafiz.post(`/projects/${ctx.projectId}/work-items`, { type: "MAR", title, answers: { manufacturer: "UAT Maker", trade: ctx.trade, location: ctx.location } });
  if (!c.check("a MAR Draft with Description empty is created through the api", res.status === 201, `${res.status} ${res.text.slice(0, 200)}`)) return;
  const id = (res.body as { id: string }).id;
  const { page } = await pageAs("hafiz", { locale: "ar" });
  await go(page, `/work-items/${id}`, "ar");
  await settle(page);
  const main = page.getByRole("main");
  const labels = (await main.innerText()).replace(/\s+/g, " ");
  c.check("field labels and section titles are Arabic (تفاصيل المادة, الوصف)", /[؀-ۿ]/.test(labels) && /الوصف/.test(labels), labels.slice(0, 200));
  const inputs = await page.locator("input, textarea").evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value).join(" | "));
  c.check("the values typed in English stay as typed (UAT Maker)", /UAT Maker/.test(labels + " " + inputs), inputs.slice(0, 120));
  await t.shot(page, "form-ar");
  await main.getByRole("button", { name: "إرسال للمراجعة" }).first().click();
  await page.waitForTimeout(1500);
  const dlg = page.getByRole("dialog");
  const open = (await dlg.count()) > 0;
  if (open) {
    const fill = await dlg.innerText();
    await t.shot(page, "send-for-review-ar");
    await dlg.getByRole("button", { name: "إرسال للمراجعة" }).click().catch(() => undefined);
    await page.waitForTimeout(1500);
    void fill;
  }
  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const alert = (await page.getByRole("alert").allInnerTexts()).join(" | ");
  c.check("the missing-fields message is shown, in Arabic", /[؀-ۿ]/.test(alert || after) && /(الوصف|مطلوب|إلزامي|املأ|ناقص)/.test(alert || after), alert || after.slice(0, 300));
  const stage = (await hafiz.get(`/work-items/${id}`)).body as { stage: { key: string } };
  c.check("the item stays in Draft (nothing sent)", stage.stage.key === "draft", stage.stage.key);
  await t.shot(page, "missing-fields-ar");
  t.note("Alert text read: " + (alert || "(no role=alert element)").slice(0, 300));
});

// -------------------------------------------------------------------------------------------------

defineCase("I18N-05", async (t) => {
  const c = tracker(t);
  for (const who of ["faisal", "noura"] as const) {
    // A browser set to English: the page's language follows the browser, not the Member's stored language.
    const en = await pageAs(who, { locale: "en" });
    await en.page.goto(`${webUrl}/`, { waitUntil: "networkidle" });
    const enPath = new URL(en.page.url()).pathname;
    c.check(`${who}: with an English browser the app opens in Arabic because the Member's language is Arabic`, enPath.startsWith("/ar"), `opened ${enPath}`);
    const me = await en.page.evaluate(async () => (await (await fetch("/api/v1/me")).json()) as { member: { locale: string; fullName: { ar: string } } });
    c.check(`${who}: the Member's stored language is ar`, me.member.locale === "ar", me.member.locale);
    if (who === "faisal") await t.shot(en.page, "faisal-english-browser");
    await en.context.close();
    // A browser set to Arabic: opens in Arabic, name in Arabic, can switch.
    const ar = await pageAs(who, { locale: "ar" });
    await ar.page.goto(`${webUrl}/`, { waitUntil: "networkidle" });
    await settle(ar.page);
    const arPath = new URL(ar.page.url()).pathname;
    const html = await overflowOf(ar.page);
    c.check(`${who}: with an Arabic browser the app opens in Arabic, right to left`, arPath.startsWith("/ar") && html.dir === "rtl", `${arPath} dir=${html.dir}`);
    const names = (await ar.page.getByRole("button").allInnerTexts()).join(" ");
    c.check(`${who}: the name shows in Arabic`, new RegExp(me.member.fullName.ar.split(" ")[0]!).test(names), names.slice(0, 80));
    await switchLanguage(ar.page, "en", /[؀-ۿ]{2,}/);
    c.check(`${who}: can switch to English`, new URL(ar.page.url()).pathname.startsWith("/en"), ar.page.url());
    await ar.context.close();
  }
  t.note("Sign-in itself needs a password, so the harness uses each person's demo session. The app opens in the browser's language (the URL decides; next-intl negotiates it): the Member's stored language 'ar' only sets the language of their emails (apps/web/src/lib/browser-locale.ts, data-model member_notification_preference). The plan's expectation 'Arabic from sign-in' holds only for an Arabic browser.");
});

// -------------------------------------------------------------------------------------------------

defineCase("I18N-06", async (t) => {
  const c = tracker(t);
  const hafiz = await Api.as("hafiz");
  const { projectId } = await marContext(hafiz);
  const rows = await items(hafiz, projectId);
  const some = rows.find((r) => r.documentNumber) ?? rows[0]!;
  const { page } = await pageAs("hafiz", { phone: true });
  const ux: string[] = [];
  const pages: [string, string][] = [
    ["Home", "/"],
    ["Projects", "/projects"],
    ["Submittals List", `/projects/${projectId}/work-items`],
    ["Kanban", `/projects/${projectId}/work-items?view=kanban`],
    ["an item", `/work-items/${some.id}`],
    ["Settings", `/projects/${projectId}/settings`],
  ];
  const probe = async (name: string) => {
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const small: string[] = [];
      document.querySelectorAll("a[href], button, [role=button], [role=radio], [role=switch], [role=checkbox], select, input").forEach((e) => {
        const b = (e as HTMLElement).getBoundingClientRect();
        if (b.width === 0 || b.height === 0 || b.bottom < 0 || b.top > window.innerHeight * 3) return;
        if (b.height < 44 || b.width < 44) small.push(((e.getAttribute("aria-label") || e.textContent || e.tagName) as string).trim().replace(/\s+/g, " ").slice(0, 30));
      });
      const tables = [...document.querySelectorAll("table")].map((tb) => {
        let p: HTMLElement | null = tb.parentElement;
        let scroller = false;
        while (p && p !== document.body) {
          const ox = getComputedStyle(p).overflowX;
          if ((ox === "auto" || ox === "scroll") && p.scrollWidth >= p.clientWidth) scroller = true;
          if (scroller) break;
          p = p.parentElement;
        }
        return { wide: tb.scrollWidth > vw, scroller };
      });
      const cut: string[] = [];
      document.querySelectorAll("main *").forEach((e) => {
        const el = e as HTMLElement;
        const cs = getComputedStyle(el);
        if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "hidden" && cs.textOverflow !== "ellipsis" && (el.textContent ?? "").trim()) cut.push((el.textContent ?? "").trim().slice(0, 30));
      });
      return { scroll: document.documentElement.scrollWidth, vw, small: small.length, smallSample: small.slice(0, 4), tables, cut: cut.slice(0, 3) };
    });
    c.check(`${name}: the page does not scroll sideways at 375`, r.scroll <= r.vw + 1, `${r.scroll} > ${r.vw}`);
    c.check(`${name}: a table wider than the screen scrolls inside its own area`, r.tables.every((x) => !x.wide || x.scroller), JSON.stringify(r.tables));
    if (r.small) ux.push(`${name}: ${r.small} controls under 44 px (e.g. ${r.smallSample.join(", ")})`);
    if (r.cut.length) ux.push(`${name}: text cut off: ${r.cut.join(" / ")}`);
  };
  for (const [name, path] of pages) {
    await go(page, path, "en");
    await settle(page, 600);
    await probe(name);
    if (name === "Home" || name === "Submittals List" || name === "Kanban") await t.shot(page, `${name.toLowerCase().replace(/\s+/g, "-")}-375`);
  }
  // The sidebar opens as a drawer.
  await go(page, "/", "en");
  await settle(page);
  const navHidden = !(await page.getByRole("navigation").first().isVisible().catch(() => false));
  await page.getByRole("button", { name: "Menu" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.waitFor({ state: "visible" }).catch(() => undefined);
  c.check("the sidebar is closed on a phone and opens as a drawer from Menu", navHidden && (await drawer.count()) > 0 && /Projects/.test(await drawer.innerText().catch(() => "")), `closed first: ${navHidden}`);
  await t.shot(page, "drawer-375");
  await page.keyboard.press("Escape");
  // The Workflow builder.
  let builderOpened = false;
  for (const who of ["hafiz", "saeed"]) {
    const p = await pageAs(who, { phone: true });
    await go(p.page, `/projects/${projectId}/settings/workflows`, "en");
    await settle(p.page, 800);
    const link = p.page.getByRole("main").locator("a[href*='/settings/workflows/']").first();
    if ((await link.count()) > 0) {
      await link.click();
      await settle(p.page, 1500);
      const o = await overflowOf(p.page);
      c.check(`Workflow builder (opened as ${who}): the page does not scroll sideways at 375`, o.scroll <= o.inner + 1, `${o.scroll} > ${o.inner}`);
      await t.shot(p.page, "workflow-builder-375");
      builderOpened = true;
      break;
    }
  }
  if (!builderOpened) t.note("The Workflow builder could not be opened (no Workflow link in Project Settings for Hafiz or Saeed).");
  t.note("UX recommendations (do not fail this case): " + (ux.join("; ") || "none found"));
});

// -------------------------------------------------------------------------------------------------

defineCase("I18N-07", async (t) => {
  const c = tracker(t);
  const ali = await Api.as("ali");
  const { projectId } = await marContext(ali);
  const rows = await items(ali, projectId);
  const some = rows.find((r) => r.documentNumber) ?? rows[0]!;
  for (const width of [1366, 1920]) {
    const height = width === 1920 ? 1080 : 800;
    const { page } = await pageAs("ali", { width, height });
    const places: [string, string][] = [
      ["Home", "/"],
      ["List", `/projects/${projectId}/work-items`],
      ["Kanban", `/projects/${projectId}/work-items?view=kanban`],
      ["item", `/work-items/${some.id}`],
    ];
    for (const [name, path] of places) {
      await go(page, path, "en");
      await settle(page, 600);
      const o = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        const side = document.querySelector("nav")?.getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, vw: window.innerWidth, main: main ? Math.round(main.width) : 0, side: side ? Math.round(side.width) : 0, vh: document.documentElement.scrollHeight };
      });
      c.check(`${width} px ${name}: no sideways scroll, a sidebar and a main area`, o.scroll <= o.vw + 1 && o.main > 500 && o.side > 100, `scroll ${o.scroll}/${o.vw}, main ${o.main}, sidebar ${o.side}`);
      if (width === 1920 && (name === "List" || name === "Kanban")) await t.shot(page, `${name.toLowerCase()}-${width}`);
      if (width === 1366 && name === "item") await t.shot(page, `item-${width}`);
    }
  }
  t.note("The script checks that each page fills the width without sideways scroll; whether the layout follows the reference screens is Part UX (ui-ux-tester).");
});

// -------------------------------------------------------------------------------------------------

defineCase("I18N-08", async (t) => {
  const c = tracker(t);
  const hafiz = await Api.as("hafiz");
  const { projectId } = await marContext(hafiz);
  const rows = await items(hafiz, projectId);
  const real = rows.find((r) => r.documentNumber === "TWR-MAR-01-0001") ?? rows.find((r) => r.documentNumber)!;
  type Probe = { status: number | undefined; notFound: boolean; text: string; html: string; links: string };
  const probe = async (who: string, path: string, locale: "en" | "ar"): Promise<Probe> => {
    const { context, page } = await pageAs(who, { locale });
    try {
      const status = (await page.goto(urlOf(path, locale), { waitUntil: "networkidle" }))?.status();
      const marker = page.getByTestId("not-found");
      const notFound = (await marker.count()) > 0;
      const text = notFound ? (await marker.first().innerText()).replace(/\s+/g, " ").trim() : "";
      const html = notFound ? (await marker.first().evaluate((e) => e.outerHTML)).replace(/[0-9a-f-]{36}/g, "ID") : "";
      const links = notFound ? (await marker.first().getByRole("link").evaluateAll((es) => es.map((e) => `${(e.textContent ?? "").trim()}->${e.getAttribute("href")}`).join(","))) + "|" + (await marker.first().getByRole("button").allInnerTexts()).join(",") : "";
      if (locale === "en" && who === "nasser" && path.includes("work-items")) await t.shot(page, `nasser-${path.includes(real.id) ? "real" : "made-up"}-en`);
      return { status, notFound, text, html, links };
    } finally {
      await context.close();
    }
  };
  for (const locale of ["en", "ar"] as const) {
    const a = await probe("nasser", `/work-items/${real.id}`, locale);
    const b = await probe("nasser", "/work-items/00000000-0000-4000-8000-000000000001", locale);
    const d = await probe("nasser", "/no-such-page-uat", locale);
    const h = await probe("hafiz", "/work-items/00000000-0000-4000-8000-000000000002", locale);
    c.check(`${locale}: all four show the plain not-found page`, [a, b, d, h].every((x) => x.notFound), JSON.stringify([a, b, d, h].map((x) => x.status)));
    c.check(`${locale}: the Riyadh Gate Tower item (Nasser has no access) and a made-up item are the same page`, a.text === b.text && a.html === b.html && a.status === b.status, `${a.status} "${a.text}" vs ${b.status} "${b.text}"`);
    c.check(`${locale}: a made-up URL shows the same page too`, a.text === d.text && a.text === h.text && a.status === d.status && a.status === h.status, `${d.status} "${d.text}"`);
    c.check(`${locale}: never a 403 (status 404 or 200 with the same page)`, [a, b, d, h].every((x) => x.status !== 403), JSON.stringify([a, b, d, h].map((x) => x.status)));
    if (locale === "en") {
      c.check("the English text says it may not exist or you may not have access, with a Projects button", /We (can.?t|can ?not|cannot) find this page/i.test(a.text) && /(may not exist|not exist)/i.test(a.text) && /(may not have access|not have access)/i.test(a.text) && /Projects/.test(a.links + a.text), `"${a.text}" ${a.links}`);
    } else c.check("the Arabic page has a Projects button and Arabic text", /[؀-ۿ]/.test(a.text) && /المشاريع/.test(a.links + a.text), `"${a.text}" ${a.links}`);
  }
  void projectId;
  void openProject;
});
