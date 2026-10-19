import { readFileSync, writeFileSync } from "node:fs";
const f = "packages/infra/test/storage.test.ts";
let s = readFileSync(f, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("x " + a.slice(0, 40)); s = s.replace(a, b); };
rep("nothing but each item's Documental Record; it never", "nothing but each item's Documental Record and the Snag reports (RP-677); it never");
rep("expect(worker).toHaveLength(5);", "expect(worker).toHaveLength(6);");
rep("documental-record\/\*$/)],\n", "documental-record\/\*$/)],\n      [\"s3:PutObject\", expect.stringMatching(/\/projects\/\*\/snag-reports\/\*$/)],\n");
writeFileSync(f, s);
