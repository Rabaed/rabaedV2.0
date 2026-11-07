import { formFields, screenProblems } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { rabaedScreenFile } from "./rabaed-defaults.ts";

// RP-1237 (gap table v3 row 34, the owner's answer: "Add photo and Attach file now"): a Review Code's
// Action Form offers its signer a photo field and a file field, both optional, so a Code still goes through
// with no file. They are the Screen's own reply files (ADR 0024): shared with the Code, and the Documental
// Record prints them (RP-1029).
describe("the Review Code Screens' reply files", () => {
  for (const key of ["code_a", "code_b", "code_c", "code_d"]) {
    it(`${key} offers an optional photo field and an optional file field, and passes the Screen checks`, () => {
      const screen = rabaedScreenFile(key);
      const files = formFields(screen.schema).filter((f) => f.type === "photos" || f.type === "attachments");
      expect(files.map((f) => f.type).sort()).toEqual(["attachments", "photos"]);
      for (const field of files) expect(field.required).toBe(false);
      expect(screenProblems(screen.schema, screen.internalFields, { optionListIds: new Set() })).toEqual([]);
    });
  }
});
