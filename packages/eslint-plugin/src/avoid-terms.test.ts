import { describe, expect, it } from "vitest";
import { avoidTermIn, avoidTermInCopy, parseAvoidTerms, readsAsCopy } from "./avoid-terms.ts";

const glossary = `
**Company**:
A legal business.
_Avoid_: Tenant, organization, Project company

**Option List**:
A managed list of choices.
_Avoid_: List (on its own), dropdown

**Form**:
The middle of a Work Item.
_Avoid_: Template (on its own), general template

**Comment**:
Text on a Snag.
_Avoid_: Note, Comments (reserved for the Snag List)

**Subject**:
The short line.
_Avoid_: Title, name
`;

const list = parseAvoidTerms(glossary, ["name"]);
const found = (text: string, kind?: "name" | "text") => avoidTermIn(text, list, kind)?.term ?? null;

describe("parseAvoidTerms", () => {
  it("reads every Avoid term, one per comma, without the explanations in brackets", () => {
    expect(list.terms.map((t) => t.term)).toEqual(["Tenant", "organization", "Project company", "List", "dropdown", "Template", "general template", "Note", "Title", "name"]);
  });

  it("leaves out a term the glossary defines itself", () => {
    expect(found("comments")).toBeNull();
  });

  it("marks a term qualified (on its own) as bare-only", () => {
    expect(list.terms.filter((t) => t.bareOnly).map((t) => t.term)).toEqual(["List", "Template"]);
  });
});

describe("avoidTermIn", () => {
  it.each([
    ["tenantId", "Tenant"],
    ["tenant_id", "Tenant"],
    ["TENANT_ID", "Tenant"],
    ["tenants", "Tenant"],
    ["create-organization", "organization"],
    ["Add a tenant to the Project", "Tenant"],
    ["projectCompany", "Project company"],
    ["Every Project company has a Member", "Project company"],
    ["noteText", "Note"],
    ["generalTemplate", "general template"],
  ])("finds %s", (text, term) => {
    expect(found(text)).toBe(term);
  });

  it.each(["companyId", "organizational", "tenancy", "Every Project {company} takes part", "projectId", "isLandscape", "noted"])("ignores %s", (text) => {
    expect(found(text)).toBeNull();
  });

  it("lets an Avoid word stand inside a glossary term", () => {
    expect(found("optionList")).toBeNull();
    expect(found("OptionLists")).toBeNull();
    expect(found("Option List")).toBeNull();
    expect(found("dropdownOptionList")).toBe("dropdown");
  });

  it("flags a bare-only term only as a whole label", () => {
    expect(found("List")).toBe("List");
    expect(found("Template")).toBe("Template");
    expect(found("Template", "name")).toBeNull();
    expect(found("template", "name")).toBeNull();
    expect(found("lists")).toBeNull(); // an id, not a label
    expect(found("Template for the Form")).toBeNull();
    expect(found("mailTemplate")).toBeNull();
  });

  it("skips the caller's allowed words", () => {
    expect(found("name")).toBeNull();
    expect(found("displayName")).toBeNull();
    expect(found("title")).toBe("Title");
  });

  it("allows a phrase, not the word everywhere", () => {
    const withPhrase = parseAvoidTerms(glossary, ["note book"]);
    expect(avoidTermIn("noteBook", withPhrase)).toBeNull();
    expect(avoidTermIn("note", withPhrase)?.term).toBe("Note");
  });
});

describe("readsAsCopy", () => {
  it.each(["Edit the title", "Status", "Remove {name} from this Project?", "Check the email and both names."])("reads %s as copy", (text) => {
    expect(readsAsCopy(text)).toBe(true);
  });

  it.each([
    "status",
    "work_item.title",
    "size-6 text-notes",
    "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
    "select title from work_item",
    "m.full_name as fullName",
  ])("reads %s as code", (text) => {
    expect(readsAsCopy(text)).toBe(false);
  });
});

describe("avoidTermInCopy", () => {
  const names = parseAvoidTerms(glossary, ["name", "title"]);
  const copy = (text: string) => avoidTermInCopy(text, parseAvoidTerms(glossary), names)?.term ?? null;

  it("checks the words as text and a quoted code name as a name", () => {
    expect(copy("Edit the name")).toBe("name");
    expect(copy("Set displayName first")).toBeNull();
    expect(copy("Set tenantId first")).toBe("Tenant");
  });

  it("never joins the words either side of a code name into a phrase", () => {
    expect(copy("Every Project {company} takes part")).toBeNull();
  });

  it("still sees a bare label", () => {
    expect(copy("Template")).toBe("Template");
  });
});
