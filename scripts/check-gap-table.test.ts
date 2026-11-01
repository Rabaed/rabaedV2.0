import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGapTable, parseArgs } from "./check-gap-table.ts";

// A throwaway repo with the rule sources a rule-forced row may quote, and an
// owner reference folder (the owner's pages sit in D:\Artifacts, never in the repo).
let repo: string;
let refs: string;

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-gap-repo-"));
  refs = mkdtempSync(join(tmpdir(), "rabaed-gap-refs-"));
  write(repo, "docs/adr/0017-signed-transitions.md", "# Signed Transitions\n\nEvery Transition is signed by the\nMember who takes it.\n");
  write(repo, "docs/visibility.md", "# Visibility\n\nV14. A Company never sees **another Company's** Work Items.\n");
  write(repo, "GLOSSARY.md", "**Step Age**:\nWeeks since the Step started, shown as 1–4+ dots.\n");
  write(repo, "CLAUDE.md", "- Rabaed shows no due dates, deadlines or SLAs: only Step Age.\n");
  write(refs, "Rabaed Settings Workflows.html", "<style>\n.wl.sel{background:var(--ec);color:#fff}\n</style>\n<script>\nselect(0);\n</script>\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(refs, { recursive: true, force: true });
});

const header = "| # | Element | Reference source | Built | Verdict | Proposal | Rule |\n|---|---|---|---|---|---|---|\n";
const table = (...rows: string[]) => `# Workflow builder gap table\n\n${header}${rows.join("\n")}\n`;
const check = (markdown: string, withRefs = true) => checkGapTable(markdown, { repo, refs: withRefs ? refs : undefined });

describe("checkGapTable", () => {
  it("passes a table whose rows cite their reference source and quote their rule", () => {
    const markdown = table(
      "| 1 | Selected Transition label | Rabaed Settings Workflows.html › `.wl.sel` | outlined | gap | fill it | |",
      "| 2 | Signature on a Transition | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | ADR 0017: \"Every Transition is signed by the Member who takes it.\" |",
      "| 3 | First Step chosen | Rabaed Settings Workflows.html › line 5 | yes | match | | |",
    );
    expect(check(markdown)).toEqual([]);
  });

  it("refuses a file with no gap table", () => {
    expect(check("# Notes\n\nNo table here.\n")).toEqual([expect.stringMatching(/no gap table/i)]);
  });

  it("refuses a table missing a required column", () => {
    const markdown = "| # | Element | Built | Verdict |\n|---|---|---|---|\n| 1 | Label | outlined | gap |\n";
    expect(check(markdown)).toEqual([expect.stringMatching(/no gap table/i)]);
  });

  it("refuses a row with no reference source", () => {
    const errors = check(table("| 1 | Selected Transition label | | outlined | gap | fill it | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*reference source/i)]);
  });

  it("refuses a source that names no part: a file alone is not a citation", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html | outlined | gap | fill it | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*`<file> › <part>`/)]);
  });

  it("refuses a source whose part is not a selector, a line or a screenshot", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html › the top bar | outlined | gap | fill it | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*the top bar/)]);
  });

  it("accepts several citations in one cell, separated by semicolons", () => {
    const markdown = table("| 1 | Label | Rabaed Settings Workflows.html › `.wl.sel`; Rabaed Settings Workflows.html › screenshot 2 | outlined | gap | fill it | |");
    expect(check(markdown)).toEqual([]);
  });

  it("refuses an unknown verdict, so a rule-forced row can't hide under another word", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html › screenshot 1 | outlined | forced | fill it | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*verdict "forced"/i)]);
  });

  it("refuses a rule-forced row with no quoted rule line", () => {
    const errors = check(table("| 2 | Signature | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | ADR 0017 |"));
    expect(errors).toEqual([expect.stringMatching(/row 2.*quote/i)]);
  });

  it("refuses a rule-forced row quoting a source that is not an ADR, visibility.md, GLOSSARY.md or CLAUDE.md", () => {
    const errors = check(table("| 2 | Signature | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | the owner: \"sign every Transition\" |"));
    expect(errors).toEqual([expect.stringMatching(/row 2.*ADR nnnn/)]);
  });

  it("refuses a quote that is not in the ADR it names: the RP-528 misreading of ADR 0017", () => {
    const errors = check(table("| 2 | Signature | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | drop it | ADR 0017: \"Transitions carry no signatures.\" |"));
    expect(errors).toEqual([expect.stringMatching(/row 2.*not found in docs\/adr\/0017-signed-transitions\.md/)]);
  });

  it("finds a quoted scenario in its Jira key's file under docs/visibility/scenarios/ (RP-1097)", () => {
    write(repo, "docs/visibility/scenarios/RP-412.md", "# RP-412 scenarios\n\n| # | Scenario | Who | Expected |\n|---|---|---|---|\n| RP-412-1 | C2 opens C1's item | C2 | Hidden |\n");
    const row = (rule: string) => table(`| 4 | C1's item | Rabaed Settings Workflows.html › screenshot 4 | shown | rule-forced | hide | ${rule} |`);
    expect(check(row('docs/visibility/scenarios/RP-412.md RP-412-1: "C2 opens C1\'s item"'))).toEqual([]);
    expect(check(row('docs/visibility.md RP-412-1: "C2 opens C1\'s item"'))).toEqual([expect.stringMatching(/row 4.*not found in docs\/visibility\.md/)]);
    expect(check(row('docs/visibility/scenarios/RP-499.md: "C2 opens C1\'s item"'))).toEqual([expect.stringMatching(/row 4.*docs\/visibility\/scenarios\/RP-499\.md is not in the repo/)]);
  });

  it("refuses an ADR number with no file", () => {
    const errors = check(table("| 2 | Signature | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | ADR 0099: \"Every Transition is signed\" |"));
    expect(errors).toEqual([expect.stringMatching(/row 2.*ADR 0099/)]);
  });

  it("matches a quote across line breaks, markdown emphasis and curly quotes", () => {
    const markdown = table(
      "| 2 | Signature | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | ADR 0017: “Every Transition is signed by the Member” |",
      "| 4 | Other Company's items | Rabaed Settings Workflows.html › screenshot 4 | shown | rule-forced | hide | docs/visibility.md V14: \"A Company never sees another Company’s Work Items.\" |",
      "| 5 | Due date chip | Rabaed Settings Workflows.html › screenshot 5 | shown | rule-forced | Step Age | CLAUDE.md: \"no due dates, deadlines or SLAs\"; GLOSSARY.md Step Age: \"shown as 1–4+ dots\" |",
    );
    expect(check(markdown)).toEqual([]);
  });

  it("checks every quote in a Rule cell, so a second wrong one is found too", () => {
    const errors = check(
      table("| 5 | Due date | Rabaed Settings Workflows.html › screenshot 5 | shown | rule-forced | Step Age | CLAUDE.md: \"no due dates\"; GLOSSARY.md: \"shown as days\" |"),
    );
    expect(errors).toEqual([expect.stringMatching(/row 5.*"shown as days".*GLOSSARY\.md/)]);
  });

  it("checks a quoted rule on a row that is not rule-forced too", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html › screenshot 1 | outlined | question | ask | ADR 0017: \"no signatures\" |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*"no signatures"/)]);
  });

  it("refuses a CSS selector the reference file does not have: the RP-528 'outlined' claim", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html › `.wl.outline` | outlined | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*`\.wl\.outline` is not in Rabaed Settings Workflows\.html/)]);
  });

  it("refuses a selector found only as the start of a longer one", () => {
    write(refs, "b.css", ".wl.selected{color:red}\n");
    const errors = check(table("| 1 | Label | b.css › `.wl.sel` | outlined | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*`\.wl\.sel` is not in b\.css/)]);
  });

  it("refuses a fragment of a selector: `.wl` alone is not the rule `.wl.sel{…}`", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html › `.wl` | outlined | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*`\.wl` is not in/)]);
  });

  // RP-1209: some owner pages keep their CSS in a script string, each rule after a literal `\n`.
  // This page is made up for the test; an owner page never goes into the repo. Its string holds the rules
  // `.chip`, `.chip.on`, `.note::before` (content "a\"b"), `.opt[data-k="1"]`, `.late` (tab-indented) and `.last`.
  const PACKED_PAGE = [
    "<!doctype html>",
    "<style>.card{padding:8px}</style>",
    "<script>",
    'const css = ".chip{color:red}\\n.chip.on{background:blue}\\n.note::before{content:\\"a\\\\\\"b\\"}\\n.opt[data-k=\\"1\\"]{x:y}\\n\\t.late{margin:0}\\n.last{top:0}";',
    "document.head.append(Object.assign(document.createElement('style'), { textContent: css }));",
    "</script>",
    "",
  ].join("\n");

  it("matches a selector in CSS packed into a script string, each rule after a literal \\n", () => {
    write(refs, "packed.html", PACKED_PAGE);
    const markdown = table(
      "| 1 | On chip | packed.html › `.chip.on` | filled | match | | |",
      "| 2 | Last rule | packed.html › `.last` | top | match | | |",
      "| 3 | Tab-indented rule | packed.html › `.late` | margin | match | | |",
    );
    expect(check(markdown)).toEqual([]);
  });

  it("still matches a selector in a <style> block of a page that also packs CSS", () => {
    write(refs, "packed.html", PACKED_PAGE);
    expect(check(table("| 1 | Card | packed.html › `.card` | padded | match | | |"))).toEqual([]);
  });

  it("refuses a selector in neither the <style> block nor the packed string", () => {
    write(refs, "packed.html", PACKED_PAGE);
    const errors = check(table("| 1 | Missing | packed.html › `.nowhere` | x | match | | |", "| 2 | Prefix | packed.html › `.chip.o` | x | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*`\.nowhere` is not in packed\.html/), expect.stringMatching(/row 2.*`\.chip\.o` is not in packed\.html/)]);
  });

  it("matches the first rule of the string, which follows its opening quote", () => {
    write(refs, "packed.html", PACKED_PAGE);
    write(refs, "single.html", "<script>const css = '.one{a:b}\\n.two{c:d}';\nconst more = [`.three{e:f}`];</script>\n");
    const markdown = table(
      "| 1 | First rule | packed.html › `.chip` | red | match | | |",
      "| 2 | Single quotes | single.html › `.one`; single.html › `.two` | x | match | | |",
      "| 3 | Backticks | single.html › `.three` | x | match | | |",
    );
    expect(check(markdown)).toEqual([]);
  });

  it("does not take a selector in a quoted script argument or in a comment for a CSS rule", () => {
    write(refs, "calls.html", '<script>\nconst rows = document.querySelectorAll(".ghost, .row");\n/* .boxed{a:b} */\nconst css = ".real{a:b}\\n.also,\\n.pair{c:d}";\n</script>\n<style>\n/* .styled{a:b} */\n.shown{a:b}\n</style>\n');
    const refused = check(table("| 1 | Call | calls.html › `.ghost` | x | match | | |", "| 2 | Comment | calls.html › `.boxed` | x | match | | |", "| 3 | Comment | calls.html › `.styled` | x | match | | |"));
    expect(refused).toEqual([expect.stringMatching(/row 1.*`\.ghost`/), expect.stringMatching(/row 2.*`\.boxed`/), expect.stringMatching(/row 3.*`\.styled`/)]);
    expect(check(table("| 1 | Real | calls.html › `.real`; calls.html › `.also`; calls.html › `.pair`; calls.html › `.shown` | x | match | | |"))).toEqual([]);
  });

  it("takes no selector of a quoted selector list that never reaches a rule's brace, whichever quote or place", () => {
    write(refs, "lists.html", "<script>\ndocument.querySelectorAll(\".ghost, .row, .x\");\ndocument.querySelectorAll('.one, .two, .three');\nroot.matches(`.a, .b, .c`);\n// .slashed{a:b}\n</script>\n");
    const cited = [".row", ".x", ".two", ".three", ".b", ".c"];
    const errors = check(table(...cited.map((selector, i) => `| ${i + 1} | Call | lists.html › \`${selector}\` | x | match | | |`)));
    expect(errors).toHaveLength(cited.length);
    expect(check(table("| 1 | Line comment | lists.html › `.slashed` | x | match | | |"))).toEqual([]);
  });

  it("matches the first selector of a list whose later selector holds a quoted attribute value", () => {
    write(refs, "attr.html", '<script>const css = ".opt, .opt[data-k=\\"1\\"], .third{x:y}";</script>\n');
    expect(check(table("| 1 | Opt | attr.html › `.opt`; attr.html › `.third` | x | match | | |"))).toEqual([]);
  });

  it("matches a selector holding an escaped quote, and scans past one inside a rule", () => {
    write(refs, "packed.html", PACKED_PAGE);
    const markdown = table("| 1 | Option | packed.html › `.opt[data-k=\"1\"]`; packed.html › `.note::before`; packed.html › `.late` | x | match | | |");
    expect(check(markdown)).toEqual([]);
  });

  it("reads \\u and \\x escapes and a backslash before a line break", () => {
    write(refs, "escaped.html", '<script>const css = ".u{a:b}\\u000a.x{c:d}\\x0a.\\\njoined{e:f}";</script>\n');
    const markdown = table("| 1 | U | escaped.html › `.x`; escaped.html › `.joined` | x | match | | |");
    expect(check(markdown)).toEqual([]);
  });

  it("does not take an escaped backslash before an n for a newline", () => {
    write(refs, "packed.html", '<script>const css = ".a{b:c}\\\\n.hidden{d:e}";</script>\n');
    const errors = check(table("| 1 | Hidden | packed.html › `.hidden` | x | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*`\.hidden` is not in packed\.html/)]);
  });

  it("counts a line of a packed page in the file's real lines, not the string's rules", () => {
    write(refs, "packed.html", PACKED_PAGE);
    const markdown = table("| 1 | The string | packed.html › line 4 | x | match | | |", "| 2 | Past the end | packed.html › line 8 | x | match | | |");
    expect(check(markdown)).toEqual([expect.stringMatching(/row 2.*line 8.*6 lines/)]);
  });

  it("refuses line 0 and a range whose first line is after its last", () => {
    const errors = check(table("| 1 | A | Rabaed Settings Workflows.html › line 0 | x | match | | |", "| 2 | B | Rabaed Settings Workflows.html › lines 400–2 | x | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*count from 1/), expect.stringMatching(/row 2.*count from 1/)]);
  });

  it("refuses a reference file outside the refs folder", () => {
    write(refs, "../outside.html", "a\n");
    const errors = check(table("| 1 | A | ../outside.html › line 1 | x | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*outside/)]);
  });

  it("ignores a trailing semicolon in the source cell", () => {
    expect(check(table("| 1 | A | Rabaed Settings Workflows.html › screenshot 1; | x | match | | |"))).toEqual([]);
  });

  it("reads a table whose separator has one dash per column", () => {
    const markdown = "| # | Element | Reference source | Built | Verdict | Proposal | Rule |\n|-|-|-|-|-|-|-|\n| 1 | A | | x | gap | | |\n";
    expect(check(markdown)).toEqual([expect.stringMatching(/row 1.*no reference source/)]);
  });

  it("refuses a quote too short to show the rule", () => {
    const errors = check(table("| 5 | Due date | Rabaed Settings Workflows.html › screenshot 5 | shown | rule-forced | Step Age | CLAUDE.md: \"no due\" |"));
    expect(errors).toEqual([expect.stringMatching(/row 5.*too short/)]);
  });

  it("refuses a quote that only matches inside longer words", () => {
    const errors = check(table("| 2 | Signature | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | ADR 0017: \"very Transition is sign\" |"));
    expect(errors).toEqual([expect.stringMatching(/row 2.*not found/)]);
  });

  it("matches a quote across markdown underscores, as GLOSSARY.md's _Avoid_ lines", () => {
    write(repo, "GLOSSARY.md", "**Member**:\nA person.\n_Avoid_: account holder, person\n");
    const markdown = table("| 1 | A | Rabaed Settings Workflows.html › screenshot 1 | x | rule-forced | y | GLOSSARY.md Member: \"Avoid: account holder, person\" |");
    expect(check(markdown)).toEqual([]);
  });

  it("refuses a line past the reference file's end", () => {
    const errors = check(table("| 1 | Label | Rabaed Settings Workflows.html › line 400 | outlined | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*line 400.*6 lines/)]);
  });

  it("refuses a reference file that is not in the refs folder", () => {
    const errors = check(table("| 1 | Label | Rabaed Missing.html › screenshot 1 | outlined | match | | |"));
    expect(errors).toEqual([expect.stringMatching(/row 1.*Rabaed Missing\.html.*not found/)]);
  });

  it("checks only the citation's shape without a refs folder", () => {
    const markdown = table("| 1 | Label | Rabaed Missing.html › `.nowhere` | outlined | match | | |");
    expect(check(markdown, false)).toEqual([]);
  });

  it("finds a reference file in a subfolder of the refs folder by its path", () => {
    write(refs, "submittal-panel/source/drawer.css", ".drawer{width:480px}\n");
    const markdown = table("| 1 | Drawer width | submittal-panel/source/drawer.css › `.drawer` | 480 | match | | |");
    expect(check(markdown)).toEqual([]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    write(refs, "a.css", "[lang|=ar] .x{}\n");
    const markdown = table("| 1 | Arabic | a.css › `[lang\\|=ar] .x` | yes | match | | |");
    expect(check(markdown)).toEqual([]);
  });

  it("passes the example in design/owner-reference-process.md, its quotes read from this repo", () => {
    const doc = readFileSync(join(import.meta.dirname, "../design/owner-reference-process.md"), "utf8");
    expect(checkGapTable(doc, { repo: join(import.meta.dirname, "..") })).toEqual([]);
  });

  it("checks every gap table in the file and names each row's table", () => {
    const markdown = `${table("| 1 | A | Rabaed Settings Workflows.html › screenshot 1 | x | match | | |")}\n## Drawer\n\n${header}| 1 | B | | x | gap | | |\n`;
    expect(check(markdown)).toEqual([expect.stringMatching(/table 2, row 1/)]);
  });
});

describe("parseArgs", () => {
  it("reads the files and --refs in either form", () => {
    expect(parseArgs(["a.md", "--refs", "D:\\Artifacts", "b.md"])).toEqual({ files: ["a.md", "b.md"], refs: "D:\\Artifacts" });
    expect(parseArgs(["--refs=D:\\Artifacts", "a.md"])).toEqual({ files: ["a.md"], refs: "D:\\Artifacts" });
    expect(parseArgs(["a.md"])).toEqual({ files: ["a.md"], refs: undefined });
  });

  it("refuses --refs with no folder, --refs twice, and no file", () => {
    expect(parseArgs(["a.md", "--refs"])).toEqual({ error: expect.stringMatching(/needs the folder/) });
    expect(parseArgs(["--refs", "x", "--refs=y", "a.md"])).toEqual({ error: expect.stringMatching(/twice/) });
    expect(parseArgs(["--refs", "x"])).toEqual({ error: expect.stringMatching(/No gap table given/) });
  });
});
