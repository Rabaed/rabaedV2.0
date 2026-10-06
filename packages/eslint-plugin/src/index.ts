import { cssNoHardcodedColour, cssNoPhysicalDirection } from "./css-rules.ts";
import { jsonNoAvoidTerms, noAvoidTerms } from "./avoid-rules.ts";
import { jsonNoRawBidi, noRawBidi } from "./bidi-rules.ts";
import { noAwsIdsInErrors, noDeadlineWords, noHardcodedColour, noPhysicalDirection, noRawErrorLogging } from "./js-rules.ts";
import { jsonNoDeadlineWords } from "./json-rules.ts";

/**
 * Rabaed design guard rails (RP-199): design tokens only, logical (RTL-safe)
 * CSS only, and Step Age only (no deadline words), and no raw error messages in logs (RP-287). Wired up in eslint.config.js.
 */
const plugin = {
  meta: { name: "@rabaed/eslint-plugin" },
  rules: {
    "no-hardcoded-colour": noHardcodedColour,
    "no-physical-direction": noPhysicalDirection,
    "no-deadline-words": noDeadlineWords,
    "no-raw-error-logging": noRawErrorLogging,
    "no-avoid-terms": noAvoidTerms,
    "no-raw-bidi": noRawBidi,
    "no-aws-ids-in-errors": noAwsIdsInErrors,
    "css-no-hardcoded-colour": cssNoHardcodedColour,
    "css-no-physical-direction": cssNoPhysicalDirection,
    "json-no-deadline-words": jsonNoDeadlineWords,
    "json-no-avoid-terms": jsonNoAvoidTerms,
    "json-no-raw-bidi": jsonNoRawBidi,
  },
};

export default plugin;
