import { adminApiAsAppRole } from "./admin-rules.ts";
import { cssNoHardcodedColour, cssNoPhysicalDirection } from "./css-rules.ts";
import { jsonNoAvoidTerms, noAvoidTerms } from "./avoid-rules.ts";
import { jsonNoRawBidi, noRawBidi } from "./bidi-rules.ts";
import {
  localeThroughHelpers,
  noAwsIdsInErrors,
  noDeadlineWords,
  noHardcodedColour,
  noNativeDialog,
  noPhysicalDirection,
  noRawErrorLogging,
  noUiTranslations,
  useClientDirective,
} from "./js-rules.ts";
import { jsonNoDeadlineWords, jsonNoPluralPound } from "./json-rules.ts";
import { noBufferSlice } from "./buffer-rules.ts";

/**
 * Rabaed design guard rails (RP-199): design tokens only, logical (RTL-safe)
 * CSS only, and Step Age only (no deadline words), and no raw error messages in logs (RP-287).
 * Also "use client" on every component file that needs it, and no translations in @rabaed/ui (RP-362), and
 * Rabaed Admin runs the api's code only as the app role (RP-987). Wired up in eslint.config.js.
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
    "locale-through-helpers": localeThroughHelpers,
    "no-aws-ids-in-errors": noAwsIdsInErrors,
    "use-client-directive": useClientDirective,
    "no-ui-translations": noUiTranslations,
    "no-native-dialog": noNativeDialog,
    "admin-api-as-app-role": adminApiAsAppRole,
    "css-no-hardcoded-colour": cssNoHardcodedColour,
    "css-no-physical-direction": cssNoPhysicalDirection,
    "json-no-deadline-words": jsonNoDeadlineWords,
    "json-no-avoid-terms": jsonNoAvoidTerms,
    "json-no-raw-bidi": jsonNoRawBidi,
    "json-no-plural-pound": jsonNoPluralPound,
    "no-buffer-slice": noBufferSlice,
  },
};

export default plugin;
