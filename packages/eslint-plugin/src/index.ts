import { cssNoHardcodedColour, cssNoPhysicalDirection } from "./css-rules.ts";
import { noDeadlineWords, noHardcodedColour, noPhysicalDirection } from "./js-rules.ts";
import { jsonNoDeadlineWords } from "./json-rules.ts";

/**
 * Rabaed design guard rails (RP-199): design tokens only, logical (RTL-safe)
 * CSS only, and Step Age only (no deadline words). Wired up in eslint.config.js.
 */
const plugin = {
  meta: { name: "@rabaed/eslint-plugin" },
  rules: {
    "no-hardcoded-colour": noHardcodedColour,
    "no-physical-direction": noPhysicalDirection,
    "no-deadline-words": noDeadlineWords,
    "css-no-hardcoded-colour": cssNoHardcodedColour,
    "css-no-physical-direction": cssNoPhysicalDirection,
    "json-no-deadline-words": jsonNoDeadlineWords,
  },
};

export default plugin;
