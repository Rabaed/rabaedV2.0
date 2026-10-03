// Rabaed Admin's screens (ADR 0010). Plain script, no build step: it calls
// the JSON API on the same address. English and Arabic, right to left in
// Arabic; numbers stay in Latin digits and CR and VAT numbers left to right.
"use strict";

const text = {
  en: {
    title: "Rabaed Admin",
    otherLanguage: "العربية",
    signOut: "Sign out",
    signInTitle: "Sign in",
    email: "Email",
    password: "Password",
    continue: "Continue",
    code: "Code",
    codeSent: (email) => `We emailed a 6-digit code to ${email}. It works once, for 10 minutes.`,
    signIn: "Sign in",
    startOver: "Start again",
    onboardTitle: "Onboard a Company",
    onboardHint: "Creates the Company and emails its Authorized Person an invitation.",
    company: "Company",
    nameEn: "Legal name (English)",
    nameAr: "Legal name (Arabic)",
    cr: "CR number",
    vat: "VAT number",
    authorizedPerson: "Authorized Person",
    personEn: "Full name (English)",
    personAr: "Full name (Arabic)",
    language: "Language",
    reason: "Reason",
    onboard: "Onboard and invite",
    inviteTitle: "Invite an Authorized Person again",
    inviteHint: "For a Company whose Authorized Person has not accepted yet, for example when the invitation expired.",
    invite: "Send invitation",
    leadsTitle: "Onboarding leads",
    leadsHint: "CR numbers Project Admins invited that are not on Rabaed yet.",
    showLeads: "Show leads",
    project: "Project",
    host: "Host Company",
    requested: "Requested",
    state: "State",
    waiting: "Waiting",
    onboarded: "Onboarded",
    noLeads: "No onboarding leads.",
    close: "Close",
    closeTitle: (cr) => `Close the lead for CR ${cr}`,
    closeHint: "Takes it off this list only. The Project Admin still sees their invitation pending until they withdraw it.",
    closeLead: "Close lead",
    cancel: "Cancel",
    closedNotice: "Lead closed.",
    listsTitle: "Option Lists",
    listsHint:
      "Choices for Form fields, in up to three levels. Every edit needs a reason. An option is never deleted: retire it and it stops being offered, but stays where it was chosen.",
    showLists: "Show Option Lists",
    noLists: "No Option Lists yet.",
    newList: "New Option List",
    createList: "Create list",
    nameEnShort: "Name (English)",
    nameArShort: "Name (Arabic)",
    optionValue: "Value (stays the same)",
    save: "Save",
    confirm: "Confirm",
    addOption: "Add option",
    addSubOption: "Add sub-option",
    rename: "Rename",
    retire: "Retire",
    restore: "Restore",
    retired: "Retired",
    addOptionTitle: (where) => `Add an option to ${where}`,
    renameTitle: (label) => `Rename ${label}`,
    retireTitle: (label) => `Retire ${label}`,
    restoreTitle: (label) => `Restore ${label}`,
    listCreatedNotice: "Option List created.",
    savedNotice: "Saved.",
    onboardedNotice: (email) => `Company onboarded. The invitation went to ${email}.`,
    invitedNotice: (email) => `Invitation sent to ${email}.`,
    errors: {
      invalid_credentials: "That email and password don't match. After several failures, sign-in is locked for 15 minutes.",
      too_many_codes: "Too many codes asked for. Wait 15 minutes and try again.",
      invalid_code: "That code doesn't work. Codes work once, for 10 minutes; after 3 wrong tries, start again.",
      not_signed_in: "You were signed out. Sign in again.",
      duplicate_cr_number: "A Company with this CR number is already on Rabaed.",
      duplicate_vat_number: "A Company with this VAT number is already on Rabaed.",
      duplicate_email: "This email already belongs to someone on Rabaed.",
      not_found: "No Company has this CR number.",
      lead_not_open: "This lead is no longer open. Show the leads again.",
      duplicate_value: "This list already has an option with this value.",
      too_deep: "An Option List has at most three levels.",
      already_active: "This Authorized Person has already accepted.",
      invalid_request: "Check the fields and try again.",
      other: "Something went wrong. Try again.",
    },
  },
  ar: {
    title: "إدارة ربائد",
    otherLanguage: "English",
    signOut: "تسجيل الخروج",
    signInTitle: "تسجيل الدخول",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    continue: "متابعة",
    code: "الرمز",
    codeSent: (email) => `أرسلنا رمزاً من 6 أرقام إلى ${email}. يعمل مرة واحدة، لمدة 10 دقائق.`,
    signIn: "دخول",
    startOver: "البدء من جديد",
    onboardTitle: "إضافة شركة",
    onboardHint: "تُنشئ الشركة وترسل دعوة بالبريد إلى الشخص المفوّض.",
    company: "الشركة",
    nameEn: "الاسم القانوني (بالإنجليزية)",
    nameAr: "الاسم القانوني (بالعربية)",
    cr: "رقم السجل التجاري",
    vat: "الرقم الضريبي",
    authorizedPerson: "الشخص المفوّض",
    personEn: "الاسم الكامل (بالإنجليزية)",
    personAr: "الاسم الكامل (بالعربية)",
    language: "اللغة",
    reason: "السبب",
    onboard: "إضافة وإرسال الدعوة",
    inviteTitle: "إعادة دعوة الشخص المفوّض",
    inviteHint: "لشركة لم يقبل الشخص المفوّض فيها الدعوة بعد، مثلاً عند انتهاء صلاحية الدعوة.",
    invite: "إرسال الدعوة",
    leadsTitle: "طلبات الإضافة",
    leadsHint: "أرقام سجلات تجارية دعاها مسؤولو المشاريع وليست على ربائد بعد.",
    showLeads: "عرض الطلبات",
    project: "المشروع",
    host: "الشركة المستضيفة",
    requested: "تاريخ الطلب",
    state: "الحالة",
    waiting: "بالانتظار",
    onboarded: "أُضيفت",
    noLeads: "لا توجد طلبات إضافة.",
    close: "إغلاق",
    closeTitle: (cr) => `إغلاق طلب السجل التجاري ${cr}`,
    closeHint: "يزيله من هذه القائمة فقط. يبقى مسؤول المشروع يرى دعوته بانتظار الرد حتى يسحبها.",
    closeLead: "إغلاق الطلب",
    cancel: "إلغاء",
    closedNotice: "أُغلق الطلب.",
    listsTitle: "القوائم الاختيارية",
    listsHint:
      "خيارات لحقول النماذج، بحد أقصى ثلاثة مستويات. كل تعديل يحتاج سبباً. لا يُحذف أي خيار: عند إيقافه لا يعود معروضاً، لكنه يبقى حيث اختير.",
    showLists: "عرض القوائم الاختيارية",
    noLists: "لا توجد قوائم اختيارية بعد.",
    newList: "قائمة اختيارية جديدة",
    createList: "إنشاء القائمة",
    nameEnShort: "الاسم (بالإنجليزية)",
    nameArShort: "الاسم (بالعربية)",
    optionValue: "القيمة (لا تتغير)",
    save: "حفظ",
    confirm: "تأكيد",
    addOption: "إضافة خيار",
    addSubOption: "إضافة خيار فرعي",
    rename: "إعادة تسمية",
    retire: "إيقاف",
    restore: "استعادة",
    retired: "موقوف",
    addOptionTitle: (where) => `إضافة خيار إلى ${where}`,
    renameTitle: (label) => `إعادة تسمية ${label}`,
    retireTitle: (label) => `إيقاف ${label}`,
    restoreTitle: (label) => `استعادة ${label}`,
    listCreatedNotice: "أُنشئت القائمة الاختيارية.",
    savedNotice: "تم الحفظ.",
    onboardedNotice: (email) => `أُضيفت الشركة، وأُرسلت الدعوة إلى ${email}.`,
    invitedNotice: (email) => `أُرسلت الدعوة إلى ${email}.`,
    errors: {
      invalid_credentials: "البريد الإلكتروني وكلمة المرور غير متطابقين. بعد عدة محاولات فاشلة يُوقف الدخول 15 دقيقة.",
      too_many_codes: "طُلبت رموز كثيرة. انتظر 15 دقيقة وحاول مجدداً.",
      invalid_code: "الرمز غير صحيح. يعمل الرمز مرة واحدة لمدة 10 دقائق؛ بعد 3 محاولات خاطئة ابدأ من جديد.",
      not_signed_in: "تم تسجيل خروجك. سجّل الدخول مجدداً.",
      duplicate_cr_number: "توجد شركة بهذا السجل التجاري على ربائد.",
      duplicate_vat_number: "توجد شركة بهذا الرقم الضريبي على ربائد.",
      duplicate_email: "هذا البريد الإلكتروني مستخدم على ربائد.",
      not_found: "لا توجد شركة بهذا السجل التجاري.",
      lead_not_open: "لم يعد هذا الطلب مفتوحاً. اعرض الطلبات مجدداً.",
      duplicate_value: "في القائمة خيار بهذه القيمة بالفعل.",
      too_deep: "للقائمة الاختيارية ثلاثة مستويات على الأكثر.",
      already_active: "قبل الشخص المفوّض الدعوة من قبل.",
      invalid_request: "راجع الحقول وحاول مجدداً.",
      other: "حدث خطأ. حاول مجدداً.",
    },
  },
};

let locale = "en";
try {
  if (localStorage.getItem("rabaed-admin-locale") === "ar") locale = "ar";
} catch {
  // Storage blocked: English.
}
const t = () => text[locale];
const $ = (id) => document.getElementById(id);

function applyLanguage() {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  document.title = t().title;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t()[el.dataset.t];
  $("language").textContent = t().otherLanguage;
}

function notice(message, kind = "info") {
  const el = $("notice");
  el.textContent = message;
  el.dir = "auto";
  el.className = kind;
  el.hidden = !message;
}

const errorMessage = (code) => t().errors[code] ?? t().errors.other;

/** Calls the API; returns the parsed body, or throws the API's error code. */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error ?? "other";
    if (code === "not_signed_in") show("sign-in");
    throw code;
  }
  return json;
}

function show(view, who) {
  $("sign-in").hidden = view !== "sign-in";
  $("home").hidden = view !== "home";
  $("sign-out").hidden = view !== "home";
  $("who").textContent = view === "home" ? who : "";
  if (view === "sign-in") {
    $("password-form").hidden = false;
    $("code-form").hidden = true;
  }
}

async function start() {
  try {
    const { engineer } = await api("GET", "/v1/me");
    show("home", engineer.email);
  } catch {
    show("sign-in");
    notice("");
  }
}

/** Runs a form's action, showing the API's error, if any, in the page's language. */
function onSubmit(id, action) {
  $(id).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await action(Object.fromEntries(new FormData(form)), form);
    } catch (code) {
      notice(errorMessage(typeof code === "string" ? code : "other"), "error");
    } finally {
      button.disabled = false;
    }
  });
}

onSubmit("password-form", async ({ email, password }) => {
  const { codeSentTo } = await api("POST", "/v1/sign-in", { email, password });
  notice("");
  $("password-form").hidden = true;
  $("code-form").hidden = false;
  $("code-sent").textContent = t().codeSent(codeSentTo);
  $("code-sent").dir = "auto";
  $("code-form").elements.code.focus();
});

onSubmit("code-form", async ({ code }, form) => {
  await api("POST", "/v1/sign-in/code", { code });
  form.reset();
  $("password-form").reset();
  notice("");
  await start();
});

$("start-over").addEventListener("click", () => {
  show("sign-in");
  notice("");
});

onSubmit("onboard-form", async (f, form) => {
  const { invitationSentTo } = await api("POST", "/v1/companies", {
    legalName: { en: f.legalNameEn, ar: f.legalNameAr },
    crNumber: f.crNumber,
    vatNumber: f.vatNumber,
    authorizedPerson: { email: f.email, fullName: { en: f.fullNameEn, ar: f.fullNameAr }, locale: f.locale },
    reason: f.reason,
  });
  form.reset();
  notice(t().onboardedNotice(invitationSentTo));
});

onSubmit("invite-form", async ({ crNumber, reason }, form) => {
  const { invitationSentTo } = await api("POST", "/v1/invitations", { crNumber, reason });
  form.reset();
  notice(t().invitedNotice(invitationSentTo));
});

onSubmit("leads-form", async ({ reason }) => {
  const { leads } = await api("GET", `/v1/onboarding-leads?${new URLSearchParams({ reason })}`);
  const table = $("leads");
  const body = table.querySelector("tbody");
  body.replaceChildren(
    ...leads.map((lead) => {
      const row = document.createElement("tr");
      const cells = [
        [lead.crNumber, "ltr"],
        [`${lead.project.code} · ${lead.project.name[locale]}`],
        [lead.hostCompany.legalName[locale]],
        [lead.requestedAt.slice(0, 10), "ltr"],
        [lead.convertedAt ? t().onboarded : t().waiting],
      ];
      for (const [value, dir] of cells) {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (dir) cell.dir = dir;
        row.append(cell);
      }
      const actions = document.createElement("td");
      if (!lead.convertedAt) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "link";
        close.textContent = t().close;
        close.addEventListener("click", () => openCloseForm(lead, row));
        actions.append(close);
      }
      row.append(actions);
      return row;
    }),
  );
  table.hidden = leads.length === 0;
  notice(leads.length === 0 ? t().noLeads : "");
});

// Closing a lead: the row it came from, removed once closed.
let closingRow = null;

function openCloseForm(lead, row) {
  const form = $("close-form");
  form.reset();
  form.elements.leadId.value = lead.id;
  $("close-title").textContent = t().closeTitle(lead.crNumber);
  $("close-title").dir = "auto";
  closingRow = row;
  form.hidden = false;
  form.elements.reason.focus();
}

$("close-cancel").addEventListener("click", () => {
  $("close-form").hidden = true;
  closingRow = null;
});

onSubmit("close-form", async ({ leadId, reason }, form) => {
  try {
    await api("POST", `/v1/onboarding-leads/${encodeURIComponent(leadId)}/close`, { reason });
  } catch (code) {
    // The API's not_found here is the lead, not a CR number.
    throw code === "not_found" ? "lead_not_open" : code;
  }
  form.hidden = true;
  closingRow?.remove();
  closingRow = null;
  notice(t().closedNotice);
});

// Option Lists (RP-279): every edit asks for a reason; options are never deleted.
const MAX_LEVELS = 3;

function linkButton(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "link";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function optionItem(option, level) {
  const item = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = option.label[locale];
  label.dir = "auto";
  const value = document.createElement("code");
  value.textContent = option.value;
  value.dir = "ltr";
  item.append(label, " ", value);
  if (option.retired) {
    const tag = document.createElement("em");
    tag.className = "muted";
    tag.textContent = ` (${t().retired})`;
    item.append(tag);
  }
  const name = option.label[locale];
  item.append(
    " ",
    linkButton(t().rename, () => openOptionForm("rename", option.id, t().renameTitle(name), option.label)),
    " ",
    option.retired
      ? linkButton(t().restore, () => openReasonForm("restore", option.id, t().restoreTitle(name)))
      : linkButton(t().retire, () => openReasonForm("retire", option.id, t().retireTitle(name))),
  );
  if (level < MAX_LEVELS) {
    item.append(" ", linkButton(t().addSubOption, () => openOptionForm("add", option.id, t().addOptionTitle(name), null, option.listId)));
  }
  if (option.options.length > 0) item.append(optionTree(option.options, level + 1));
  return item;
}

function optionTree(options, level) {
  const ul = document.createElement("ul");
  for (const option of options) ul.append(optionItem(option, level));
  return ul;
}

/** Marks every option with its list, so "add a sub-option" knows where to add. */
function withList(options, listId) {
  for (const option of options) {
    option.listId = listId;
    withList(option.options, listId);
  }
}

async function loadLists() {
  const { optionLists } = await api("GET", "/v1/option-lists");
  const box = $("lists");
  box.replaceChildren();
  for (const list of optionLists) {
    withList(list.options, list.id);
    const name = list.name[locale];
    const heading = document.createElement("h3");
    heading.textContent = name;
    heading.dir = "auto";
    box.append(heading, linkButton(t().addOption, () => openOptionForm("add-root", list.id, t().addOptionTitle(name), null, list.id)), optionTree(list.options, 1));
  }
  $("list-form").hidden = false;
  box.hidden = false;
  if (optionLists.length === 0) notice(t().noLists);
}

function openOptionForm(mode, targetId, title, label, listId) {
  const form = $("option-form");
  form.reset();
  $("reason-form").hidden = true;
  form.elements.mode.value = mode;
  form.elements.targetId.value = targetId;
  form.dataset.listId = listId ?? "";
  const adding = mode !== "rename";
  $("option-value-label").hidden = !adding;
  form.elements.value.required = adding;
  if (label) {
    form.elements.labelEn.value = label.en;
    form.elements.labelAr.value = label.ar;
  }
  $("option-title").textContent = title;
  $("option-title").dir = "auto";
  form.hidden = false;
  (adding ? form.elements.value : form.elements.labelEn).focus();
}

function openReasonForm(mode, targetId, title) {
  const form = $("reason-form");
  form.reset();
  $("option-form").hidden = true;
  form.elements.mode.value = mode;
  form.elements.targetId.value = targetId;
  $("reason-title").textContent = title;
  $("reason-title").dir = "auto";
  form.hidden = false;
  form.elements.reason.focus();
}

$("lists-load").addEventListener("click", () => {
  loadLists().catch((code) => notice(errorMessage(typeof code === "string" ? code : "other"), "error"));
});
$("option-cancel").addEventListener("click", () => {
  $("option-form").hidden = true;
});
$("reason-cancel").addEventListener("click", () => {
  $("reason-form").hidden = true;
});

onSubmit("list-form", async (f, form) => {
  await api("POST", "/v1/option-lists", { name: { en: f.nameEn, ar: f.nameAr }, reason: f.reason });
  form.reset();
  await loadLists();
  notice(t().listCreatedNotice);
});

onSubmit("option-form", async (f, form) => {
  const label = { en: f.labelEn, ar: f.labelAr };
  if (f.mode === "rename") {
    await api("POST", `/v1/options/${encodeURIComponent(f.targetId)}/rename`, { label, reason: f.reason });
  } else {
    // "add-root": the target is the list; "add": it is the parent option, in the list this form was opened for.
    const root = f.mode === "add-root";
    await api("POST", `/v1/option-lists/${encodeURIComponent(root ? f.targetId : form.dataset.listId)}/options`, {
      parentId: root ? null : f.targetId,
      value: f.value,
      label,
      reason: f.reason,
    });
  }
  form.hidden = true;
  await loadLists();
  notice(t().savedNotice);
});

onSubmit("reason-form", async (f, form) => {
  await api("POST", `/v1/options/${encodeURIComponent(f.targetId)}/${f.mode}`, { reason: f.reason });
  form.hidden = true;
  await loadLists();
  notice(t().savedNotice);
});

$("sign-out").addEventListener("click", async () => {
  await api("DELETE", "/v1/session").catch(() => undefined);
  show("sign-in");
  notice("");
});

$("language").addEventListener("click", () => {
  locale = locale === "en" ? "ar" : "en";
  try {
    localStorage.setItem("rabaed-admin-locale", locale);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  applyLanguage();
  // A message stays in the language it was written in; clear it rather than mix the two.
  notice("");
});

applyLanguage();
start();
