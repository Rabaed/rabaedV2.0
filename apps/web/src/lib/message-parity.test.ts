import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messageArguments, messageParityProblems } from "./message-parity.ts";

const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

describe("the English and Arabic message files", () => {
  it("hold the same keys, each a non-empty string with the same arguments", () => {
    expect(messageParityProblems({ en: messages("en"), ar: messages("ar") })).toEqual([]);
  });
});

describe("a gap between two message files", () => {
  it("is a key in one locale only, named by its path", () => {
    expect(messageParityProblems({ en: { shell: { profile: "Profile", signOut: "Sign out" } }, ar: { shell: { profile: "الملف" } } })).toEqual([
      "shell.signOut: missing in ar",
    ]);
    expect(messageParityProblems({ en: {}, ar: { home: { title: "رباعد" } } })).toEqual(["home: missing in en", "home.title: missing in en"]);
  });

  it("is a string in one locale and an object in the other", () => {
    expect(messageParityProblems({ en: { nav: "Main" }, ar: { nav: { main: "الرئيسية" } } })).toEqual([
      "nav: string in en, object in ar",
      "nav.main: missing in en",
    ]);
  });

  it("is an empty value", () => {
    expect(messageParityProblems({ en: { title: "Rabaed" }, ar: { title: " " } })).toEqual(["title: empty in ar"]);
  });

  it("is a value that is neither a string nor an object", () => {
    expect(messageParityProblems({ en: { count: 3 }, ar: { count: 3 } })).toEqual(["count: not a string or an object"]);
  });

  it("is an argument in one locale's message and not the other's", () => {
    expect(messageParityProblems({ en: { signedInAs: "Signed in as {name}, {company}" }, ar: { signedInAs: "مسجّل الدخول باسم {name}" } })).toEqual([
      "signedInAs: arguments differ (en: {company, name}; ar: {name})",
    ]);
  });

  it("is nothing when both match, whatever the arguments' order", () => {
    expect(messageParityProblems({ en: { a: { b: "{x} of {y}" } }, ar: { a: { b: "{y} من {x}" } } })).toEqual([]);
  });
});

describe("the arguments in an ICU message", () => {
  const args = (message: string) => [...messageArguments(message)].sort();

  it("are the names in braces", () => {
    expect(args("Signed in as {name}, {company}")).toEqual(["company", "name"]);
    expect(args("No arguments")).toEqual([]);
  });

  it("include a formatted argument and those inside plural or select options", () => {
    expect(args("{size, number} MB")).toEqual(["size"]);
    expect(args("{count, plural, =0 {none} one {# Step by {name}} other {# Steps}}")).toEqual(["count", "name"]);
    expect(args("{role, select, admin {Admin of {company}} other {Member}}")).toEqual(["company", "role"]);
  });

  it("skip quoted braces", () => {
    expect(args("Type '{name}' literally, it''s {real}")).toEqual(["real"]);
  });
});
