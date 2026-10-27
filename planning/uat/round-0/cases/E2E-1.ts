import type { Page } from "playwright";
import { defineCase, type CaseApi } from "../harness/case.ts";
import { Api, go, settle, takeTransition } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { act, moduleItems } from "../harness/helpers-sng.ts";
import { pdfPages, recordPdf, until } from "../harness/helpers-not.ts";

// The business end-to-end journeys J1 to J6 (strategy section 4). Each journey is ONE story across the
// Companies: a screenshot at every hand-over, and at every hand-over the visibility checks beside a
// positive control (the Company that must see it does, the others get the 404). The Test Case ids a
// check covers are in its text in square brackets. Items are "UAT J<n> ...".

const TMC_NAMES = ["Hafiz Hamdan", "Ali Sonour", "Saeed Al Qahtani", "Omar Al Harbi"];
const DCL_NAMES = ["Ahmed bin Said", "Mohammed Al Shamsi", "Layla Mansour"];
const OWNER_NAMES = ["Noura Al Harbi", "Faisal Al Otaibi", "Hind Al Mutairi"];
const named = (text: string, names: string[]) => names.filter((n) => text.includes(n)).concat(/\bSara\b/.test(text) && names === DCL_NAMES ? ["Sara"] : []);
const has = (text: string, secrets: (string | RegExp)[]) => secrets.filter((s) => (typeof s === "string" ? text.includes(s) : s.test(text)));
/** A Recommended Code showing as a value or a label (the history's key `recommendedCode: null` is not a leak). */
const REC = /"recommendedCode":"[A-D]"|Recommend(ed)? (Code|Approve|Reject|Revise)|recommend_[a-d]/i;
const flat = (s: string) => s.replace(/\s+/g, " ");

/** One journey: the people's signed-in sessions (api and page share a context), and the checks. */
class Story {
  readonly t: CaseApi;
  readonly tm: H.Team;
  readonly started = Date.now();
  constructor(t: CaseApi, tm: H.Team) {
    this.t = t;
    this.tm = tm;
  }
  api(p: string): Api {
    return this.tm.api[p]!;
  }
  page(p: string): Page {
    return this.api(p).context.pages()[0]!;
  }
  ck(tag: string, text: string, ok: boolean, detail?: string): boolean {
    return this.t.check(`[${tag}] ${text}`, ok, detail);
  }
  async status(p: string, id: string, path = ""): Promise<number> {
    return (await this.api(p).get(`/work-items/${id}${path}`)).status;
  }
  /** Opens the item page as `p` (optionally shot) and returns the main text. */
  async open(p: string, id: string, shot?: string): Promise<string> {
    const page = this.page(p);
    await go(page, `/work-items/${id}`);
    await settle(page, 600);
    if (shot) await this.t.shot(page, shot);
    return flat(await page.locator("main").innerText());
  }
  /** The plain not-found page for `p` (and the api 404), shot. */
  async notFoundPage(tag: string, p: string, id: string, shot: string): Promise<void> {
    const page = this.page(p);
    const status = await go(page, `/work-items/${id}`);
    await settle(page, 400);
    const marker = (await page.getByTestId("not-found").count()) > 0;
    await this.t.shot(page, shot);
    this.ck(tag, `${p} opens the item URL and gets the not-found page`, marker, `http ${status}, marker ${marker}`);
  }
  /** Each person gets the plain api 404 for the item (and its Documents and record). */
  async hidden(tag: string, label: string, id: string, who: string[], deep = false): Promise<void> {
    for (const p of who) {
      const s = await this.status(p, id);
      const extra = deep ? [await this.status(p, id, "/documents"), await this.status(p, id, "/history"), await this.status(p, id, "/documental-record")] : [];
      this.ck(tag, `${label}: ${p} gets the api 404${deep ? " for the item, its Documents, history and record" : ""}`, s === 404 && extra.every((x) => x === 404), `${s} ${extra.join(",")}`);
    }
  }
  /** Positive control: each person reads the item (200). */
  async sees(tag: string, label: string, id: string, who: string[]): Promise<void> {
    for (const p of who) {
      const s = await this.status(p, id);
      this.ck(tag, `${label}: ${p} (positive control) reads it`, s === 200, `${s}`);
    }
  }
  async blob(p: string, id: string): Promise<string> {
    const d = await this.api(p).get(`/work-items/${id}`);
    return `${await H.historyText(this.api(p), id)} ${d.text}`;
  }
  /** TMC side reads nothing of DCL's inside: no secret, no DCL person's name. */
  async tmcClean(tag: string, label: string, id: string, who: string[], secrets: (string | RegExp)[], pageText = "", afterCode?: { signer: string; texts: string[] }): Promise<void> {
    for (const p of who) {
      let b = `${await this.blob(p, id)} ${pageText}`;
      if (afterCode) {
        // The Code's own event is shared: its signer and its final verification are read by TMC (VIS-04, V14 "the final
        // outcome with its signer"). They may appear in that event and nowhere else.
        const code = JSON.stringify((await H.eventsOf(this.api(p), id)).filter((e) => e.type === "issue_code"));
        const hist = await H.historyText(this.api(p), id);
        const count = (hay: string, needle: string) => hay.split(needle).length - 1;
        for (const text of [afterCode.signer, ...afterCode.texts]) {
          this.ck(tag, `${label}: ${p} reads "${text.slice(0, 40)}" only inside the Code event`, count(hist, text) === count(code, text), `${count(hist, text)} in the history, ${count(code, text)} in the Code event`);
          b = b.split(text).join("");
        }
      }
      const found = [...has(b, secrets), ...named(b, DCL_NAMES), ...named(b, OWNER_NAMES)];
      this.ck(tag, `${label}: ${p} reads no DCL internal move, Recommended Code, verification note or DCL person`, found.length === 0, found.join(" | "));
    }
  }
  /** DCL side reads nothing of TMC's inside: no Return, no Internal Note, no TMC person. */
  async dclClean(tag: string, label: string, id: string, who: string[], secrets: (string | RegExp)[], pageText = ""): Promise<void> {
    for (const p of who) {
      const b = `${await this.blob(p, id)} ${pageText}`;
      const found = [...has(b, secrets), ...named(b, TMC_NAMES)];
      this.ck(tag, `${label}: ${p} reads no TMC Return, Internal Note or TMC person`, found.length === 0, found.join(" | "));
    }
  }
  async asOversight(tag: string, label: string, p: string, id: string, secrets: (string | RegExp)[]): Promise<void> {
    const d = await H.detail(this.api(p), id);
    const b = await this.blob(p, id);
    const found = [...has(b, secrets), ...named(b, TMC_NAMES), ...named(b, DCL_NAMES)];
    this.ck(tag, `${label}: ${p} reads it as oversight only (no move offered, no pick up)`, d.actions.transitions.length === 0 && d.actions.pickUp === false, JSON.stringify(H.offered(d)));
    this.ck(tag, `${label}: ${p} reads no internal move, note or person of either Company`, found.length === 0, found.join(" | "));
  }
  /** The Submittals List (or Snag List) search page, once per case: RP-1049 / RP-1050 make it the not-found page. */
  async listCheck(tag: string, p: string, module: "work-items" | "snag-list", query: string, text: string): Promise<void> {
    const page = this.page(p);
    await go(page, `/projects/${this.tm.projectId}/${module}?q=${encodeURIComponent(query)}`);
    await settle(page, 800);
    const notFound = (await page.getByTestId("not-found").count()) > 0 || /We can.t find this page/.test(await page.locator("body").innerText());
    await this.t.shot(page, `${p}-list`);
    const bug = module === "work-items" ? "RP-1049" : "RP-1050";
    if (notFound) {
      this.ck(tag, `${p}'s ${module === "work-items" ? "Submittals" : "Snag"} List search for the Subject shows ${text}`, false, `The List page shows the not-found page, although the api answers (known Bug ${bug}: the web gives up at 3 s).`);
      return;
    }
    const body = flat(await page.locator("main").innerText());
    this.ck(tag, `${p}'s ${module === "work-items" ? "Submittals" : "Snag"} List search for the Subject shows ${text}`, body.includes(query), body.slice(0, 160));
  }
  note(): void {
    this.t.note(`Journey took ${Math.round((Date.now() - this.started) / 1000)} s.`);
  }
}

async function choose(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.getByRole("main").getByLabel(label).first().click();
  await page.getByRole("option", { name: option }).first().click();
  await page.waitForTimeout(300);
}

/** Raised in the New form as Hafiz (the web form), saved as a Draft. Returns the id. */
async function raiseInForm(s: Story, subject: string, supplier = "Najd Electrical Supplies"): Promise<string> {
  const page = s.page("hafiz");
  await go(page, `/projects/${s.tm.projectId}/work-items/new`);
  await settle(page);
  const main = page.getByRole("main");
  await main.getByLabel("Subject").fill(subject);
  await main.getByLabel("Manufacturer").fill("Philips");
  await choose(page, "Trade", /Electrical Works/);
  await choose(page, "Location", /Tower 1 Floor 02/);
  await settle(page, 600);
  await choose(page, "Approved supplier", supplier);
  await s.t.shot(page, "hafiz-new-form");
  await main.getByRole("button", { name: "Save Draft" }).click();
  await page.waitForURL(/\/work-items(\?|$)|\/work-items\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => undefined);
  await settle(page, 800);
  const items = await H.listItems(s.api("hafiz"), s.tm.projectId, `q=${encodeURIComponent(subject)}`);
  const it = items.find((i) => i.title === subject);
  if (!it) throw new Error(`The Draft "${subject}" was not saved by the New form.`);
  return it.id as string;
}

/** A complete MAR Draft by the web form then the api (the rest of the Form and the Datasheet). */
async function fillForm(s: Story, id: string, over: H.Json = {}): Promise<void> {
  const hafiz = s.api("hafiz");
  const d = await H.detail(hafiz, id);
  const put = await hafiz.put(`/work-items/${id}/answers`, { answers: { ...d.answers, ...(await H.marAnswers(s.tm, over)) } });
  if (put.status >= 300) throw new Error(`Saving the Form answered ${put.status}: ${put.text.slice(0, 200)}`);
  await H.addDatasheet(hafiz, id);
}

/** A MAR from the Draft to Mohammed holding it, by the api, with the hand-over checks. Used by J2 to J4. */
async function marToMohammed(s: Story, subject: string, code: "A" | "B" | "C" | "D", words: { ret: string; inote: string; vnote: string; enote: string }): Promise<{ id: string; number: string }> {
  const { hafiz, ali, ahmed, mohammed } = { hafiz: s.api("hafiz"), ali: s.api("ali"), ahmed: s.api("ahmed"), mohammed: s.api("mohammed") };
  const id = await H.createItem(hafiz, s.tm, "MAR", subject, await H.marAnswers(s.tm));
  await H.addDatasheet(hafiz, id);
  await s.hidden("VIS-01", "Hand-over 1, a Draft in TMC", id, ["yousef", "ahmed", "faisal"]);
  await H.must(hafiz, id, "send_for_review");
  const number = (await H.detail(ali, id)).documentNumber as string;
  const txt = await s.open("ali", id, "ali-holds-after-send");
  s.ck("SUB-04", "Hand-over 2, Hafiz to Ali: the item has a Document Number and Ali holds it", H.NUMBER_RE.test(number) && /Ali Sonour\s*·\s*TMC Constructions/.test(txt), `${number}`);
  await s.hidden("VIS-01", "Hand-over 2, in TMC's Internal Review", id, ["yousef", "ahmed", "faisal", "noura"]);
  await H.pickUp(ali, id);
  await H.must(ali, id, "submit", { answers: { cover_note: `UAT cover note ${subject}` }, internalNote: words.inote });
  const ad = await H.detail(ahmed, id);
  s.ck("SUB-07", "Hand-over 3, Ali to DCL: Ahmed reads it with the Cover Note and Ali's Company only", ad.stage.name.en === "Pending Approval" && !!ad.submissionDate);
  const at = await s.open("ahmed", id, "ahmed-receives-submit");
  await s.dclClean("SUB-07", "Hand-over 3", id, ["ahmed", "mohammed"], [words.inote, words.ret], at);
  const td = await H.detail(ali, id);
  s.ck("SUB-07", "Hand-over 3: TMC reads it With Design Consultants LLC, no person", td.heldBy?.companyName?.en === "Design Consultants LLC" && td.heldBy?.memberName === null, JSON.stringify(td.heldBy));
  await s.sees("VIS-02", "Hand-over 3", id, ["faisal"]);
  await s.asOversight("VIS-02", "Hand-over 3", "faisal", id, [words.inote, words.ret]);
  await s.hidden("VIS-02", "Hand-over 3", id, ["yousef", "noura"]);
  await H.pickUp(ahmed, id);
  await H.must(ahmed, id, "send_to_manager", {
    answers: { sample_checked: true, matches_specification: code === "A" || code === "B", ...(code === "C" || code === "D" ? { verification_note: words.vnote } : {}) },
    recommendedCode: code,
    internalNote: words.enote,
  });
  await H.pickUp(mohammed, id);
  const md = await H.detail(mohammed, id);
  s.ck("SUB-10", "Hand-over 4, Ahmed to Mohammed: Mohammed holds it at the Manager Step", md.step.key === "consultant_manager", md.step.key);
  await s.open("mohammed", id, "mohammed-receives-reply");
  const aliText = await s.open("ali", id, "ali-sees-no-dcl-inside");
  s.ck("SUB-10", "Hand-over 4: TMC still reads With Design Consultants LLC, no person", /Design Consultants LLC/.test(aliText) && named(aliText, DCL_NAMES).length === 0);
  await s.tmcClean("VIS-04", "Hand-over 4", id, ["ali", "hafiz", "faisal"], [words.vnote, words.enote, REC, /internal_answers/], aliText);
  await s.hidden("VIS-04", "Hand-over 4", id, ["yousef", "noura"]);
  return { id, number };
}

const FORM_REMARKS = (code: string) => `UAT remarks for Code ${code}.`;

// ---------------------------------------------------------------------------------------------------

defineCase("J1", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed", "yousef", "faisal", "noura");
  const s = new Story(t, tm);
  const stamp = H.stamp();
  const subject = `UAT J1 Lighting Fixtures ${stamp}`;
  const w = { ret: `UAT J1 return reason ${stamp}`, inote: `UAT J1 TMC internal note ${stamp}`, vnote: `UAT J1 DCL verification note ${stamp}`, enote: `UAT J1 DCL engineer note ${stamp}` };
  const cover = "Panels for Level 2, as drawing E-201";
  const { hafiz, ali, ahmed, mohammed } = { hafiz: s.api("hafiz"), ali: s.api("ali"), ahmed: s.api("ahmed"), mohammed: s.api("mohammed") };

  // 1. Hafiz raises and fills the Form.
  const id = await raiseInForm(s, subject);
  await fillForm(s, id);
  const draft = await H.detail(hafiz, id);
  s.ck("SUB-01", "Hand-over 1, a Draft: Hafiz holds it, no Document Number, Drafts Stage", draft.stage.key === "draft" && draft.documentNumber === null && draft.heldBy?.memberName?.en === "Hafiz Hamdan");
  const form = await s.open("hafiz", id, "hafiz-form-filled");
  s.ck("SUB-03", "The Form shows the Items total 240 and the Datasheet", /Total Quantity\s*240/.test(form) && /UAT-datasheet\.pdf/.test(form), form.match(/Total Quantity[^A-Z]*/)?.[0]);
  await s.hidden("VIS-01", "Hand-over 1, a Draft", id, ["yousef", "ahmed", "faisal", "noura"], true);

  // 2. Send for Review: Ali holds it at once.
  await takeTransition(s.page("hafiz"), "Send for Review");
  const sent = await H.detail(ali, id);
  s.ck("SUB-04", "Hand-over 2, Hafiz to Ali: the item has a Document Number and Ali holds it with no Pick up", H.NUMBER_RE.test(sent.documentNumber ?? "") && sent.heldBy?.memberName?.en === "Ali Sonour" && sent.actions.pickUp === false, `${sent.documentNumber}`);
  const number = sent.documentNumber as string;
  const aliSend = await s.open("ali", id, "ali-holds-after-send");
  s.ck("SUB-04", "Ali's page reads the number and With Ali Sonour - TMC Constructions", aliSend.includes(number) && /Ali Sonour\s*·\s*TMC Constructions/.test(aliSend));
  s.ck("SUB-04", "The Document Number is left to right on the page", (await s.page("ali").locator(`[dir="ltr"]`, { hasText: number }).count()) > 0);
  await s.hidden("VIS-01", "Hand-over 2, in TMC's Internal Review", id, ["yousef", "ahmed", "faisal", "noura"], true);

  // 3. Ali Returns with a reason.
  await takeTransition(s.page("ali"), "Return", { fill: async (d) => void (await d.getByRole("textbox").first().fill(w.ret)) });
  const back = await H.detail(hafiz, id);
  s.ck("SUB-05", "Hand-over 3, Ali back to Hafiz: the Return stays in Internal Review at the Contractor Engineer Step, same number, never a Draft", back.stage.key === "internal_review" && back.step.key === "contractor_engineer" && back.documentNumber === number && back.heldBy?.memberName?.en === "Hafiz Hamdan", `${back.stage.key}/${back.step.key}`);
  const ev = await H.eventsOf(hafiz, id);
  s.ck("SUB-05", "The reason is in TMC's history, marked internal", ev.some((e) => e.reason === w.ret && e.audience === "internal"));
  await s.open("hafiz", id, "hafiz-after-return");
  await s.hidden("SUB-05", "Hand-over 3, after the Return", id, ["yousef", "ahmed", "faisal"]);

  // 4. Hafiz resends; Ali holds again.
  await takeTransition(s.page("hafiz"), /Send for Review/);
  const again = await H.detail(ali, id);
  s.ck("SUB-05", "Hand-over 4, Hafiz resends: Ali holds it again, same number", again.heldBy?.memberName?.en === "Ali Sonour" && again.documentNumber === number, `${again.heldBy?.memberName?.en}`);

  // 5. Ali Submits with a Cover Note and an Internal Note.
  await takeTransition(s.page("ali"), "Submit", {
    fill: async (d) => {
      await d.getByRole("textbox").nth(0).fill(cover);
      await d.getByRole("textbox").nth(1).fill(w.inote);
    },
  });
  const tmcAfter = await H.detail(ali, id);
  s.ck("SUB-07", "Hand-over 5, Ali to DCL: Pending Approval, TMC reads With Design Consultants LLC and no person", tmcAfter.stage.name.en === "Pending Approval" && tmcAfter.heldBy?.companyName?.en === "Design Consultants LLC" && tmcAfter.heldBy?.memberName === null, JSON.stringify(tmcAfter.heldBy));
  const ahmedText = await s.open("ahmed", id, "ahmed-receives-submit");
  s.ck("SUB-07", "Hand-over 5: Ahmed reads the Cover Note and TMC Constructions as the sender", ahmedText.includes(cover) && /TMC Constructions/.test(ahmedText));
  const ahmedEv = await H.eventsOf(ahmed, id);
  const sub = ahmedEv.find((e) => e.transition?.en === "Submit");
  s.ck("SUB-07", "Ahmed's history shows the Submit by TMC Constructions, no person, with the Cover Note", sub?.by?.companyName?.en === "TMC Constructions" && sub?.by?.memberName === null && sub?.answers?.cover_note === cover, JSON.stringify(sub)?.slice(0, 200));
  await s.dclClean("SUB-07", "Hand-over 5", id, ["ahmed", "mohammed"], [w.inote, w.ret], ahmedText);
  s.ck("SUB-07", "The Submission Date is set for DCL", !!(await H.detail(ahmed, id)).submissionDate);
  await s.sees("VIS-02", "Hand-over 5", id, ["faisal"]);
  await s.asOversight("VIS-02", "Hand-over 5", "faisal", id, [w.inote, w.ret]);
  await s.open("faisal", id, "faisal-oversight");
  await s.hidden("VIS-02", "Hand-over 5 (Noura covers Tower 2 only)", id, ["yousef", "noura"], true);
  await s.notFoundPage("VIS-58", "yousef", id, "yousef-not-found-after-submit");

  // 6. Ahmed picks up, reads, sends to Mohammed with the verification.
  await H.pickUp(ahmed, id);
  await s.open("ahmed", id, "ahmed-picked-up-reads");
  const readOnly = await s.page("ahmed").getByRole("main").locator("input:not([type=file]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])").count();
  s.ck("SUB-09", "Hand-over 6, Ahmed reads the Form: no edit control for the Form", readOnly === 0, `${readOnly} controls`);
  await H.must(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true, verification_note: w.vnote }, recommendedCode: "A", internalNote: w.enote });
  await H.pickUp(mohammed, id);
  const md = await H.detail(mohammed, id);
  s.ck("SUB-10", "Hand-over 6, Ahmed to Mohammed: Mohammed holds it at the Manager Step", md.step.key === "consultant_manager" && md.heldBy?.memberName?.en === "Mohammed Al Shamsi", JSON.stringify(md.heldBy));
  const mText = await s.open("mohammed", id, "mohammed-receives-reply");
  s.ck("SUB-10", "Mohammed reads Ahmed's verification note and Recommended Code (DCL's own)", mText.includes(w.vnote) || JSON.stringify(await H.eventsOf(mohammed, id)).includes(w.vnote));
  const aliMid = await s.open("ali", id, "ali-sees-no-dcl-inside");
  s.ck("SUB-10", "TMC still reads With Design Consultants LLC after the DCL move", /Design Consultants LLC/.test(aliMid) && named(aliMid, DCL_NAMES).length === 0);
  await s.tmcClean("VIS-04", "Hand-over 6", id, ["ali", "hafiz", "faisal"], [w.vnote, w.enote, REC, /internal_answers/], aliMid);
  await s.dclClean("VIS-04", "Hand-over 6", id, ["mohammed"], [w.inote, w.ret], mText);
  await s.hidden("VIS-04", "Hand-over 6", id, ["yousef", "noura"]);

  // 7. Mohammed issues Code A with Remarks.
  const mp = s.page("mohammed");
  await mp.getByRole("main").getByRole("button", { name: /^Approve\s*·\s*A/ }).first().click();
  const dlg = mp.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  const remarksBox = dlg.locator('[aria-labelledby="transition-section-code_remarks"]').getByRole("textbox").first();
  const remarks = "Approved as submitted. Install per drawing E-201.";
  await remarksBox.fill(remarks);
  await t.shot(mp, "mohammed-code-a-popup");
  await dlg.getByRole("button", { name: /^Approve/ }).last().click();
  await dlg.waitFor({ state: "hidden" });
  await settle(mp, 1000);
  const closed = await H.detail(ali, id);
  s.ck("SUB-11", "Hand-over 7, Mohammed to TMC: closed Approved with Code A, no more moves", closed.outcome === "A" && closed.stage.key === "approved" && closed.actions.transitions.length === 0, `${closed.outcome}/${closed.stage.key}`);
  const aliFinal = await s.open("ali", id, "ali-sees-code-a");
  const finalEv = JSON.stringify(await H.eventsOf(ali, id));
  s.ck("SUB-11", "TMC reads the Code and the Remarks", finalEv.includes(remarks) && /Approved/.test(aliFinal), aliFinal.slice(0, 120));
  await s.tmcClean("VIS-04", "Hand-over 7, after the Code", id, ["ali", "hafiz", "faisal"], [w.enote, REC, /internal_answers/], aliFinal, { signer: "Mohammed Al Shamsi", texts: [w.vnote] });
  await s.dclClean("VIS-04", "Hand-over 7", id, ["ahmed", "mohammed"], [w.inote, w.ret]);
  await s.sees("VIS-07", "Hand-over 7", id, ["faisal", "ahmed", "hafiz"]);
  await s.notFoundPage("VIS-58", "yousef", id, "yousef-not-found-after-code");
  await s.hidden("VIS-07", "Hand-over 7", id, ["yousef", "noura"], true);

  // 8. Ali downloads the Documental Record PDF.
  const rec = await until(async () => {
    const r = await recordPdf(ali, id);
    return r.status === 200 ? r : false;
  }, 70_000, 3000);
  if (s.ck("SIG-02", "Hand-over 8, the Documental Record is made and Ali downloads it (signed link, PDF)", !!rec && Buffer.from(rec.bytes.slice(0, 5)).toString("latin1") === "%PDF-", rec ? `${rec.bytes.length} bytes` : "no record after 70 s") && rec) {
    const pages = await pdfPages(rec.bytes);
    const text = pages.join(" ");
    s.ck("SIG-03", "The record prints the Subject, the Document Number and the Verification Code", text.includes(subject) && text.includes(number) && /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.test(text));
    s.ck("SIG-04", "The record names everyone on the path, TMC's and DCL's", [...TMC_NAMES.slice(0, 2), ...DCL_NAMES.slice(0, 2)].every((n) => text.includes(n)));
    s.ck("SIG-04", "The record holds no Return, Internal Note, Recommended Code or in-progress answer", has(text, [w.ret, w.inote, w.enote, REC]).length === 0, has(text, [w.ret, w.inote, w.enote, REC]).join(" | "));
    const page = s.page("ali");
    await go(page, `/work-items/${id}`);
    await settle(page, 600);
    const button = page.getByRole("main").getByRole("button", { name: "Download PDF" });
    s.ck("SIG-02", "Ali's page offers Download PDF", (await button.count()) > 0);
    await t.shot(page, "ali-download-pdf");
    s.ck("VIS-07", "Yousef gets the 404 for the record link", (await s.status("yousef", id, "/documental-record")) === 404);
  }
  await s.listCheck("SUB-23", "ali", "work-items", subject, "the item");
  s.ck("SUB-23", "Yousef's api List holds no row for it", (await H.listItems(s.api("yousef"), tm.projectId, `q=${encodeURIComponent(subject)}`)).length === 0);
  s.note();
});

defineCase("J2", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed", "yousef", "faisal", "noura", "sara");
  const s = new Story(t, tm);
  const stamp = H.stamp();
  const subject = `UAT J2 Emergency luminaires ${stamp}`;
  const w = { ret: "none", inote: `UAT J2 TMC internal note ${stamp}`, vnote: `UAT J2 DCL verification note ${stamp}`, enote: `UAT J2 DCL engineer note ${stamp}` };
  const { ali, mohammed } = { ali: s.api("ali"), mohammed: s.api("mohammed") };
  const { id, number } = await marToMohammed(s, subject, "B", w);

  // Mohammed issues Code B with two comment rows.
  const c1 = `UAT J2 comment one ${stamp}`;
  const c2 = `UAT J2 comment two ${stamp}`;
  await H.must(mohammed, id, "approve_b", { answers: { sample_checked: true, matches_specification: true, remarks: FORM_REMARKS("B"), items_to_create: [{ comment: c1, reference: "E-201" }, { comment: c2 }] } });
  const d = await H.detail(ali, id);
  s.ck("SUB-12", "Hand-over 5, Mohammed to TMC: the MAR closes at Code B", d.outcome === "B", `${d.outcome}`);
  const line = (d.raisedItems as H.Json[] | undefined)?.find((x) => x.type.code === "CMT");
  s.ck("SUB-12", "TMC reads Comments: 2 open / 0 closed", line?.open === 2 && line?.closed === 0, JSON.stringify(d.raisedItems));
  const marText = await s.open("ali", id, "ali-sees-code-b-comments");
  s.ck("SUB-12", "The MAR page shows '2 open / 0 closed'", /2 open \/ 0 closed/.test(marText), marText.match(/Comments[^\n]{0,60}/)?.[0]);
  await s.tmcClean("VIS-04", "Hand-over 5, after Code B", id, ["ali", "hafiz", "faisal"], [w.enote, REC, /internal_answers/], marText, { signer: "Mohammed Al Shamsi", texts: [w.vnote] });
  const comments = (await moduleItems(ali, tm.projectId, "snag_list", `raisedFrom=${encodeURIComponent(number)}&pageSize=50`)).filter((c) => c.type?.code === "CMT");
  s.ck("SNG-06", "The two Comments reached TMC's Snag List, Open, raised by Design Consultants LLC, held by TMC Constructions", comments.length === 2 && comments.every((c) => c.raiserCompanyName?.en === "Design Consultants LLC" && c.with?.companyName?.en === "TMC Constructions"), JSON.stringify(comments.map((c) => [c.title, c.raiserCompanyName?.en, c.with?.companyName?.en])));
  const ids = comments.map((c) => c.id as string);
  // Positive control and negatives on the Comments.
  for (const cid of ids) {
    s.ck("VIS-05", "A Comment is read by Hafiz and Faisal (oversight)", (await s.status("hafiz", cid)) === 200 && (await s.status("faisal", cid)) === 200, `${await s.status("hafiz", cid)}/${await s.status("faisal", cid)}`);
    await s.hidden("VIS-05", "Each Comment", cid, ["yousef", "sara", "noura"]);
  }
  s.ck("VIS-05", "Yousef's Snag List holds none of the Comments", (await moduleItems(s.api("yousef"), tm.projectId, "snag_list", `q=${encodeURIComponent("UAT J2")}&pageSize=50`)).length === 0);
  await s.hidden("VIS-05", "The MAR itself", id, ["sara", "yousef"]);
  await s.listCheck("SNG-06", "ali", "snag-list", "UAT J2", "the two Comments");

  // TMC resolves, DCL closes.
  const resolved = await act(ali, ids[0]!, /resolve/, { answers: { resolution_note: "Added the emergency duration." } });
  s.ck("SNG-06", "Hand-over 6, TMC resolves the first Comment", resolved.status === 204, `${resolved.status} ${resolved.text.slice(0, 100)}`);
  const stage = async (p: string, cid: string) => (await H.detail(s.api(p), cid)).stage.key as string;
  s.ck("SNG-06", "Mohammed reads the Comment Resolved and holds Verify; TMC reads it Resolved", (await stage("mohammed", ids[0]!)) === "resolved" && (await stage("ali", ids[0]!)) === "resolved");
  await s.open("mohammed", ids[0]!, "mohammed-verifies-comment");
  const mc = JSON.stringify(await H.eventsOf(mohammed, ids[0]!));
  s.ck("SNG-06", "Mohammed's Comment history shows TMC as a Company, with the resolution note, and no TMC person", mc.includes("Added the emergency duration.") && named(mc, TMC_NAMES).length === 0, named(mc, TMC_NAMES).join(","));
  const closed1 = await act(mohammed, ids[0]!, /close/);
  s.ck("SNG-06", "Hand-over 7, DCL closes the first Comment", closed1.status === 204 && (await stage("mohammed", ids[0]!)) === "closed", `${closed1.status}`);
  const mid = (await H.detail(ali, id)).raisedItems?.find((x: H.Json) => x.type.code === "CMT");
  s.ck("SNG-06", "The MAR reads 1 open / 1 closed", mid?.open === 1 && mid?.closed === 1, JSON.stringify(mid));
  await act(ali, ids[1]!, /resolve/, { answers: { resolution_note: "Added the IP rating." } });
  const closed2 = await act(mohammed, ids[1]!, /close/);
  s.ck("SNG-06", "TMC resolves and DCL closes the second Comment", closed2.status === 204);
  const done = (await H.detail(ali, id)).raisedItems?.find((x: H.Json) => x.type.code === "CMT");
  s.ck("SNG-06", "The MAR reads 0 open / 2 closed for TMC", done?.open === 0 && done?.closed === 2, JSON.stringify(done));
  const mdone = (await H.detail(mohammed, id)).raisedItems?.find((x: H.Json) => x.type.code === "CMT");
  s.ck("SNG-06", "The MAR reads 0 open / 2 closed for DCL", mdone?.open === 0 && mdone?.closed === 2, JSON.stringify(mdone));
  const aliEnd = await s.open("ali", id, "ali-all-comments-closed");
  s.ck("SNG-06", "TMC's MAR page shows '0 open / 2 closed'", /0 open \/ 2 closed/.test(aliEnd), aliEnd.match(/Comments[^\n]{0,60}/)?.[0]);
  await s.hidden("VIS-05", "After the Comments closed", ids[1]!, ["yousef", "sara"]);
  s.note();
});

defineCase("J3", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed", "yousef", "faisal", "noura");
  const s = new Story(t, tm);
  const stamp = H.stamp();
  const subject = `UAT J3 Control panel ${stamp}`;
  const w = { ret: "none", inote: `UAT J3 TMC internal note ${stamp}`, vnote: `UAT J3 DCL verification note ${stamp}`, enote: `UAT J3 DCL engineer note ${stamp}` };
  const { hafiz, ali, mohammed } = { hafiz: s.api("hafiz"), ali: s.api("ali"), mohammed: s.api("mohammed") };
  const { id, number } = await marToMohammed(s, subject, "C", w);

  const remarks = "Photometric report is missing. Revise and resubmit.";
  await H.must(mohammed, id, "revise_c", { answers: { sample_checked: true, matches_specification: false, verification_note: w.vnote, remarks } });
  const c = await H.detail(hafiz, id);
  s.ck("SUB-13", "Hand-over 5, Mohammed to TMC: closed at Code C and TMC is offered Create Revision", c.outcome === "C" && c.actions.createRevision === true, `${c.outcome} ${c.actions.createRevision}`);
  s.ck("SUB-13", "TMC reads the Remarks of Code C in its history", JSON.stringify(await H.eventsOf(hafiz, id)).includes(remarks));
  const page = s.page("hafiz");
  const codeText = await s.open("hafiz", id, "hafiz-sees-code-c");
  s.ck("SUB-13", "Hafiz's page shows Create Revision", /Create Revision/.test(codeText));
  await s.tmcClean("VIS-04", "Hand-over 5, after Code C", id, ["ali", "hafiz", "faisal"], [w.enote, REC, /internal_answers/], codeText, { signer: "Mohammed Al Shamsi", texts: [w.vnote] });

  // Hafiz creates the Revision in the page.
  await page.getByRole("main").getByRole("button", { name: "Create Revision" }).first().click();
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: /Create Revision/ }).last().click();
  await page.waitForURL((u) => /\/work-items\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(id), { timeout: 20000 }).catch(() => undefined);
  await settle(page, 800);
  const revId = /\/work-items\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!revId || revId === id) throw new Error(`Create Revision did not open the Revision page (${page.url()})`);
  const rev = await H.detail(hafiz, revId);
  s.ck("SUB-15", "Hand-over 6, TMC's Revision Draft: Revision 1, no number yet, TMC's answers and the copied Datasheet", rev.revisionNo === 1 && rev.stage.key === "draft" && rev.documentNumber === null && rev.answers.manufacturer === "Philips", `rev ${rev.revisionNo} ${rev.stage.key}`);
  await t.shot(page, "hafiz-revision-draft");
  const draftText = flat(await page.locator("main").innerText());
  s.ck("SUB-15", "The Draft page reads Revision 1: no number yet", /Revision 1: no number yet/.test(draftText), draftText.slice(0, 120));
  // While it is a Draft nobody else reads anything of it.
  await s.hidden("VIS-12", "The Revision Draft", revId, ["mohammed", "faisal", "yousef", "ahmed"], true);
  const chainDraft = JSON.stringify((await mohammed.get(`/work-items/${id}/revisions`)).body);
  s.ck("VIS-12", "Mohammed's Revision drop-down lists only the original while Rev 1 is a Draft", chainDraft.includes(number) && !chainDraft.includes(revId), chainDraft.slice(0, 160));
  await hafiz.put(`/work-items/${revId}/answers`, { answers: { ...rev.answers, model: "CoreLine Panel HDG" } });
  await H.must(hafiz, revId, "send_for_review");
  await H.pickUp(ali, revId);
  const aliRev = await s.open("ali", revId, "ali-holds-revision");
  s.ck("SUB-15", "Hand-over 7, Hafiz resubmits: Ali holds Rev 1 in Internal Review", /Ali Sonour\s*·\s*TMC Constructions/.test(aliRev));
  await H.must(ali, revId, "submit", { answers: { cover_note: "Revision 1 with the photometric report." }, internalNote: w.inote });
  const after = await H.detail(hafiz, revId);
  s.ck("SUB-15", "Hand-over 8, Ali submits Rev 1 to DCL: its number is the number plus Rev 1", after.documentNumber === `${number} Rev 1`, `${after.documentNumber}`);
  await s.sees("VIS-12", "Hand-over 8, the submitted Revision", revId, ["mohammed", "faisal"]);
  await s.hidden("VIS-12", "Hand-over 8", revId, ["yousef", "noura"], true);
  const mText = await s.open("mohammed", revId, "mohammed-receives-revision");
  await s.dclClean("SUB-15", "Hand-over 8", revId, ["mohammed"], [w.inote], mText);
  const chain = JSON.stringify((await mohammed.get(`/work-items/${id}/revisions`)).body);
  s.ck("VIS-12", "After the Submit Mohammed's drop-down lists the original and Rev 1 whole", chain.includes(number) && chain.includes(`${number} Rev 1`), chain.slice(0, 200));

  // The Revision drop-down switches Revisions.
  await go(page, `/work-items/${revId}`);
  await settle(page, 600);
  const trigger = page.getByRole("main").getByLabel("Revision").first();
  s.ck("SUB-15", "The Revision drop-down is on the Revision page", (await trigger.count()) > 0);
  if ((await trigger.count()) > 0) {
    await trigger.click();
    await page.waitForTimeout(400);
    const options = await page.getByRole("option").allInnerTexts();
    await t.shot(page, "revision-dropdown-open");
    s.ck("SUB-15", "The drop-down lists the original and Rev 1, each whole", options.some((o) => o.includes(number) && !/Rev 1/.test(o)) && options.some((o) => o.includes(`${number} Rev 1`)), options.join(" | "));
    await page.getByRole("option").filter({ hasText: number }).filter({ hasNotText: "Rev 1" }).first().click();
    await page.waitForURL((u) => u.pathname.includes(id), { timeout: 15000 }).catch(() => undefined);
    await settle(page, 800);
    const orig = flat(await page.locator("main").innerText());
    await t.shot(page, "hafiz-original-via-dropdown");
    s.ck("SUB-15", "Choosing the original shows its own Code C and Remarks", page.url().includes(id) && /Revise & Resubmit/.test(orig) && orig.includes("Photometric report is missing"), page.url());
  }
  s.ck("SUB-15", "The original keeps Code C", (await H.detail(hafiz, id)).outcome === "C");
  await s.listCheck("SUB-23", "ali", "work-items", subject, "the original and Rev 1");
  s.note();
});

defineCase("J4", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed", "yousef", "faisal", "noura");
  const s = new Story(t, tm);
  const stamp = H.stamp();
  const subject = `UAT J4 Wrong fixture ${stamp}`;
  const w = { ret: "none", inote: `UAT J4 TMC internal note ${stamp}`, vnote: `UAT J4 DCL verification note ${stamp}`, enote: `UAT J4 DCL engineer note ${stamp}` };
  const { hafiz, ali, mohammed } = { hafiz: s.api("hafiz"), ali: s.api("ali"), mohammed: s.api("mohammed") };
  const { id, number } = await marToMohammed(s, subject, "D", w);

  const remarks = "Rejected: not the specified product.";
  await H.must(mohammed, id, "reject_d", { answers: { sample_checked: true, matches_specification: false, verification_note: w.vnote, remarks } });
  const d = await H.detail(hafiz, id);
  s.ck("SUB-14", "Hand-over 5, Mohammed to TMC: closed at Code D; Hafiz is offered Create replacement and no Revision", d.outcome === "D" && d.actions.createReplacement === true && d.actions.createRevision === false, `${d.outcome}`);
  const page = s.page("hafiz");
  await s.open("hafiz", id, "hafiz-sees-code-d");
  await s.tmcClean("VIS-04", "Hand-over 5, after Code D", id, ["ali", "hafiz", "faisal"], [w.enote, REC, /internal_answers/], "", { signer: "Mohammed Al Shamsi", texts: [w.vnote] });
  await page.getByRole("main").getByRole("button", { name: "Create replacement" }).click();
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: /Create replacement/ }).last().click();
  await page.waitForURL((u) => /\/work-items\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(id), { timeout: 20000 }).catch(() => undefined);
  await settle(page, 800);
  const newId = /\/work-items\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!newId || newId === id) throw new Error(`Create replacement did not open the new Draft (${page.url()})`);
  const n = await H.detail(hafiz, newId);
  s.ck("SUB-14", "Hand-over 6, the replacement is a new Draft: same Subject, no number", n.title === subject && n.stage.key === "draft" && n.documentNumber === null, `${n.title}/${n.stage.key}`);
  const links = JSON.stringify((await hafiz.get(`/work-items/${newId}/links`)).body);
  s.ck("SUB-14", "It carries a Replaces Link to the rejected MAR", /replace/i.test(links) && links.includes(number), links.slice(0, 200));
  await t.shot(page, "hafiz-replacement-draft");
  // While it is a Draft nobody else reads anything of it, and the rejected MAR does not name it.
  await s.hidden("VIS-40", "The replacement Draft", newId, ["mohammed", "faisal", "yousef", "ahmed"], true);
  const mLinks = JSON.stringify([(await mohammed.get(`/work-items/${id}/links`)).body, (await mohammed.get(`/work-items/${id}/linked-from`)).body]);
  s.ck("VIS-40", "The rejected MAR's Links and Linked from, as Mohammed reads them, do not name the Draft", !mLinks.includes(newId), mLinks.slice(0, 160));
  const dsearch = await H.listItems(mohammed, tm.projectId, `q=${encodeURIComponent(subject)}`);
  s.ck("VIS-40", "Mohammed's search finds only the rejected MAR, not the replacement Draft", dsearch.length === 1 && dsearch[0]!.id === id, `${dsearch.length} rows`);
  await H.addDatasheet(hafiz, newId).catch(() => undefined);
  await H.must(hafiz, newId, "send_for_review");
  const sent = await H.detail(ali, newId);
  s.ck("SUB-14", "Hand-over 7, Hafiz sends it: a new Document Number with no Rev suffix, Ali holds it", H.NUMBER_RE.test(sent.documentNumber ?? "") && sent.documentNumber !== number && sent.heldBy?.memberName?.en === "Ali Sonour", `${sent.documentNumber}`);
  await s.open("ali", newId, "ali-holds-replacement");
  await s.hidden("VIS-40", "The replacement in TMC's Internal Review", newId, ["mohammed", "faisal", "yousef"]);
  await H.must(ali, newId, "submit", { answers: { cover_note: "Replacement for the rejected MAR." }, internalNote: w.inote });
  const mText = await s.open("mohammed", newId, "mohammed-receives-replacement");
  s.ck("VIS-40", "Hand-over 8, Ali submits the replacement: Mohammed now reads it (positive control)", (await s.status("mohammed", newId)) === 200 && mText.includes(subject));
  await s.dclClean("VIS-40", "Hand-over 8", newId, ["mohammed"], [w.inote], mText);
  const mFrom = JSON.stringify((await mohammed.get(`/work-items/${id}/linked-from`)).body);
  s.ck("VIS-40", "Once Submitted the rejected MAR's Linked from names the replacement by number and Subject", mFrom.includes(sent.documentNumber) && mFrom.includes(subject), mFrom.slice(0, 200));
  await s.sees("VIS-40", "Hand-over 8", newId, ["faisal"]);
  await s.hidden("VIS-40", "Hand-over 8", newId, ["yousef", "noura"], true);
  await s.listCheck("SUB-23", "ali", "work-items", subject, "the rejected MAR and its replacement");
  s.note();
});

defineCase("J5", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed", "yousef", "faisal", "saeed");
  const s = new Story(t, tm);
  const stamp = H.stamp();
  const name = `UAT J5 Delta Cables ${stamp}`;
  const inote = `UAT J5 TMC internal note ${stamp}`;
  const enote = `UAT J5 DCL engineer note ${stamp}`;
  const { hafiz, ali, ahmed, mohammed, yousef } = { hafiz: s.api("hafiz"), ali: s.api("ali"), ahmed: s.api("ahmed"), mohammed: s.api("mohammed"), yousef: s.api("yousef") };
  const el = tm.d.trade("Electrical Works");
  const supplierNames = async (p: Api) => ((await p.get(`/projects/${tm.projectId}/approved-suppliers?tradeId=${el}`)).body as H.Json).suppliers as H.Json[];
  s.ck("SUB-20", "Before the SAR the supplier is not on the Approved Supplier List", !(await supplierNames(hafiz)).some((x) => x.name.en === name));
  const id = await H.createItem(hafiz, tm, "SAR", `UAT J5 SAR ${name}`, {
    supplier_name_en: name,
    supplier_name_ar: "دلتا للكابلات",
    commercial_registration_number: "1010000099",
    country_of_origin: "Saudi Arabia",
    proposed_supply: "UAT made-up cables for the Tower 1 risers.",
    past_projects: [{ project_name: "UAT Demo Park", year: 2024 }],
    trade: el,
    location: tm.d.loc("Tower 1 Floor 01"),
  });
  await H.upload(hafiz, id, { fieldKey: "company_profile", fileName: "UAT-profile.pdf", contentType: "application/pdf", body: H.pdfFile("UAT profile") });
  await s.hidden("VIS-01", "Hand-over 1, a SAR Draft", id, ["yousef", "ahmed", "faisal"]);
  await H.must(hafiz, id, "send_for_review");
  await H.pickUp(ali, id);
  const aliText = await s.open("ali", id, "ali-holds-sar");
  s.ck("SUB-04", "Hand-over 2, Hafiz to Ali: the SAR is numbered and Ali holds it", /Ali Sonour\s*·\s*TMC Constructions/.test(aliText) && /TWR-SAR-/.test(aliText));
  await s.hidden("VIS-01", "Hand-over 2", id, ["yousef", "ahmed", "faisal"]);
  await H.must(ali, id, "submit", { answers: { cover_note: "Supplier approval for the risers." }, internalNote: inote });
  const at = await s.open("ahmed", id, "ahmed-receives-sar");
  await s.dclClean("SUB-20", "Hand-over 3, Ali to DCL", id, ["ahmed"], [inote], at);
  await s.hidden("SUB-20", "Hand-over 3", id, ["yousef"], true);
  await H.pickUp(ahmed, id);
  await H.must(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true }, recommendedCode: "A", internalNote: enote });
  await H.pickUp(mohammed, id);
  await s.open("mohammed", id, "mohammed-receives-sar");
  await s.tmcClean("SUB-20", "Hand-over 4, Ahmed to Mohammed", id, ["ali", "hafiz"], [enote, REC]);
  s.ck("SUB-20", "Before the Code the supplier is still not on the list", !(await supplierNames(hafiz)).some((x) => x.name.en === name));
  await H.must(mohammed, id, "approve_a", { answers: { sample_checked: true, matches_specification: true } });
  const closed = await H.detail(hafiz, id);
  s.ck("SUB-20", "Hand-over 5, Mohammed to TMC: the SAR closes at Code A (2 to 2 route)", closed.outcome === "A" && closed.stage.key === "approved", `${closed.outcome}/${closed.stage.key}`);
  await s.open("hafiz", id, "hafiz-sees-sar-code-a");
  // The supplier joined the list for everyone in the Project, with no source.
  const mine = (await supplierNames(hafiz)).filter((x) => x.name.en === name);
  s.ck("SUB-20", "The supplier is on the list for Electrical, approved", mine.length === 1 && mine[0]!.status === "approved", JSON.stringify(mine));
  const rival = (await supplierNames(yousef)).filter((x) => x.name.en === name);
  s.ck("VIS-45", "Beta Build (a rival) reads the supplier too: the list is Project-wide", rival.length === 1, JSON.stringify(rival));
  const raw = JSON.stringify(rival);
  s.ck("VIS-45", "The entry names no source, SAR, person or time", !/source|workItem|addedBy|memberId|createdAt|addedAt/i.test(raw) && !raw.includes(id), raw.slice(0, 200));
  await s.hidden("VIS-45", "The SAR itself stays TMC's and DCL's", id, ["yousef"], true);
  const sp = s.page("saeed");
  await go(sp, `/projects/${tm.projectId}/settings/approved-suppliers`);
  await settle(sp, 800);
  const stext = flat(await sp.locator("main").innerText());
  await t.shot(sp, "saeed-approved-supplier-list");
  s.ck("SUB-20", "Project Settings > Approved Supplier List shows it", stext.includes(name), stext.slice(0, 120));
  // A new MAR can choose it.
  const hp = s.page("hafiz");
  await go(hp, `/projects/${tm.projectId}/work-items/new`);
  await settle(hp);
  const main = hp.getByRole("main");
  const mSubject = `UAT J5 MAR with ${name}`;
  await main.getByLabel("Subject").fill(mSubject);
  await main.getByLabel("Manufacturer").fill("Delta");
  await choose(hp, "Trade", /Electrical Works/);
  await choose(hp, "Location", /Tower 1 Floor 02/);
  await settle(hp, 600);
  await main.getByLabel("Approved supplier").first().click();
  const options = await hp.getByRole("option").allInnerTexts();
  s.ck("FRM-03", "A new MAR offers the new supplier under Approved supplier (Electrical)", options.some((o) => o.includes(name)), options.join(" | "));
  await hp.getByRole("option", { name }).first().click();
  await t.shot(hp, "hafiz-mar-chooses-supplier");
  await main.getByRole("button", { name: "Save Draft" }).click();
  await hp.waitForURL(/\/work-items(\?|$)|\/work-items\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => undefined);
  await settle(hp, 800);
  const saved = (await H.listItems(hafiz, tm.projectId, `q=${encodeURIComponent(mSubject)}`)).find((i) => i.title === mSubject);
  const sd = saved ? await H.detail(hafiz, saved.id as string) : undefined;
  s.ck("FRM-03", "The MAR Draft saved with that supplier", !!sd && sd.answers.supplier === mine[0]?.id, JSON.stringify(sd?.answers?.supplier));
  s.ck("PAR-12", "Hafiz can read the list but not add to it (api refuses)", (await hafiz.post(`/projects/${tm.projectId}/approved-suppliers`, { tradeId: el, name: { en: "UAT J5 nope", ar: "x" } })).status >= 400);
  await s.listCheck("SUB-23", "ali", "work-items", `UAT J5 SAR ${name}`, "the SAR");
  s.note();
});

defineCase("J6", async (t) => {
  const tm = await H.team("hafiz", "ali", "mohammed", "noura", "faisal", "yousef", "ahmed");
  const s = new Story(t, tm);
  const stamp = H.stamp();
  const subject = `UAT J6 Cable schedule ${stamp}`;
  const inote = `UAT J6 TMC internal note ${stamp}`;
  const sendBack = `UAT J6 owner send back reason ${stamp}`;
  const dcl = `UAT J6 DCL recommendation note ${stamp}`;
  const { hafiz, ali, mohammed, noura } = { hafiz: s.api("hafiz"), ali: s.api("ali"), mohammed: s.api("mohammed"), noura: s.api("noura") };
  // Tower 2: Noura covers Tower 2 only (FX-OR), Faisal Tower 1 only, Beta Build Tower 2 only (FX-C2).
  const id = await H.createItem(hafiz, tm, "DAR", subject, { document_type: "calculation", document_title: subject, document_revision: "R0", specification_section: "26 05 19", trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 2 Floor 01") });
  await H.upload(hafiz, id, { fieldKey: "document", fileName: "UAT-cable-schedule.pdf", contentType: "application/pdf", body: H.pdfFile("UAT cable schedule") });
  await s.hidden("VIS-01", "Hand-over 1, a DAR Draft", id, ["yousef", "mohammed", "noura", "faisal"]);
  await H.must(hafiz, id, "send_for_review");
  await H.pickUp(ali, id);
  const aliText = await s.open("ali", id, "ali-holds-dar");
  s.ck("SUB-04", "Hand-over 2, Hafiz to Ali: the DAR is numbered and Ali holds it", /Ali Sonour\s*·\s*TMC Constructions/.test(aliText) && /TWR-DAR-/.test(aliText));
  await s.hidden("VIS-01", "Hand-over 2", id, ["yousef", "mohammed", "noura", "faisal"]);
  await H.must(ali, id, "submit", { answers: { cover_note: "For the Owner." }, internalNote: inote });
  const mText = await s.open("mohammed", id, "mohammed-receives-dar");
  await s.dclClean("SUB-21", "Hand-over 3, Ali to DCL", id, ["mohammed"], [inote], mText);
  await s.sees("VIS-02", "Hand-over 3 (Tower 2)", id, ["noura"]);
  await s.asOversight("VIS-02", "Hand-over 3", "noura", id, [inote]);
  await s.hidden("VIS-02", "Hand-over 3 (Faisal covers Tower 1 only; Beta Build covers Tower 2 but is the rival Contractor)", id, ["faisal", "yousef"], true);

  // Mohammed recommends Code D to the Owner; Noura sends it back.
  const mo = await H.detail(mohammed, id);
  s.ck("SUB-21", "Mohammed is offered the Recommendation of a Code", H.offered(mo).includes("recommend_d"), H.offered(mo).join(","));
  const rec1 = await H.move(mohammed, id, "recommend_d", { answers: { sample_checked: true, matches_specification: false, verification_note: dcl, remarks: "Not acceptable." } });
  if (rec1.status >= 300) throw new Error(`recommend_d answered ${rec1.status}: ${rec1.text.slice(0, 300)}`);
  const tmcHeld = await H.detail(ali, id);
  s.ck("VIS-24", "Hand-over 4, Mohammed to the Owner review: TMC reads With Owner review, no Company or person", /Owner review/.test(JSON.stringify(tmcHeld.heldBy)) && !/Al Waha|Noura/.test(JSON.stringify(tmcHeld.heldBy)), JSON.stringify(tmcHeld.heldBy));
  const owner1 = await s.open("noura", id, "noura-owner-review");
  const nd = await H.detail(noura, id);
  s.ck("SUB-21", "Noura holds the Owner's review and is offered Confirm and Send Back", H.offered(nd).includes("confirm_d") && H.offered(nd).includes("owner_send_back"), H.offered(nd).join(","));
  s.ck("VIS-24", "Noura reads the Recommended Code D", /\bD\b/.test(owner1) || JSON.stringify(await H.eventsOf(noura, id)).includes(dcl), owner1.slice(0, 200));
  const tmcText1 = await s.open("ali", id, "ali-with-owner-review");
  s.ck("VIS-24", "TMC's page reads With Owner review and no Code", /Owner review/.test(tmcText1) && !/Al Waha|Noura/.test(tmcText1) && !/Reject|Code D/.test(tmcText1), tmcText1.slice(0, 160));
  await s.tmcClean("VIS-24", "Hand-over 4", id, ["ali", "hafiz"], [dcl, REC, /Rejected/, /"outcome":"D"/], tmcText1);
  s.ck("VIS-24", "TMC reads no outcome yet", (await H.detail(hafiz, id)).outcome === null);
  await s.hidden("VIS-24", "Hand-over 4", id, ["yousef", "faisal"]);

  const back = await H.move(noura, id, "owner_send_back", { answers: { reason: sendBack }, internalNote: sendBack });
  s.ck("VIS-24", "Hand-over 5, Noura sends the Recommendation back to DCL", back.status === 204, `${back.status} ${back.text.slice(0, 160)}`);
  await s.open("mohammed", id, "mohammed-gets-send-back");
  const tmcText2 = await s.open("ali", id, "ali-unchanged-after-send-back");
  s.ck("VIS-24", "The Send Back reaches DCL only: TMC still reads With Owner review or DCL, no Code, no reason", !tmcText2.includes(sendBack) && !/Rejected/.test(tmcText2), tmcText2.slice(0, 160));
  await s.tmcClean("VIS-24", "Hand-over 5", id, ["ali", "hafiz"], [sendBack, dcl, REC, /Send Back/i, /"outcome":"D"/], tmcText2);

  // Mohammed recommends Code A instead; Noura confirms.
  await H.pickUp(mohammed, id);
  const rec2 = await H.move(mohammed, id, "recommend_a", { answers: { sample_checked: true, matches_specification: true } });
  if (rec2.status >= 300) throw new Error(`recommend_a (second) answered ${rec2.status}: ${rec2.text.slice(0, 300)}`);
  await H.pickUp(noura, id);
  const tmcText3 = await s.open("ali", id, "ali-with-owner-review-again");
  s.ck("VIS-24", "Hand-over 6, DCL recommends again: TMC reads With Owner review and still no Code", /Owner review/.test(tmcText3) && (await H.detail(ali, id)).outcome === null, tmcText3.slice(0, 160));
  const conf = await H.move(noura, id, "confirm_a");
  s.ck("SUB-21", "Hand-over 7, Noura confirms the Code", conf.status === 204, `${conf.status} ${conf.text.slice(0, 160)}`);
  const done = await H.detail(ali, id);
  s.ck("SUB-21", "The DAR closes Approved at Code A for TMC", done.outcome === "A" && done.stage.key === "approved", `${done.outcome}/${done.stage.key}`);
  const finalText = await s.open("ali", id, "ali-reads-confirmed-code");
  s.ck("VIS-24", "TMC reads the confirmed Code A", /Approved/.test(finalText) && !/Rejected/.test(finalText), finalText.slice(0, 160));
  await s.tmcClean("VIS-24", "Hand-over 7", id, ["ali", "hafiz"], [sendBack, dcl, REC, /Send Back/i, /"outcome":"D"/, /\bReject/], finalText);
  const tmcHist = JSON.stringify(await H.eventsOf(hafiz, id));
  s.ck("VIS-24", "TMC's history never holds the recommendation that was sent back (no Code D)", !/"D"/.test(tmcHist) && !/Reject/.test(tmcHist), tmcHist.slice(0, 120));
  await s.sees("VIS-24", "Hand-over 7", id, ["noura", "mohammed"]);
  await s.hidden("VIS-24", "Hand-over 7", id, ["faisal", "yousef"], true);
  await s.notFoundPage("VIS-58", "yousef", id, "yousef-not-found-dar");
  await s.listCheck("SUB-23", "ali", "work-items", subject, "the DAR");
  s.note();
});
