/**
 * The colours the annotate view marks photos with (RP-656); red, the first, by
 * default. Not themed: they are drawn into the photo's own pixels, which look
 * the same in every theme, and are stored that way in its annotated copy.
 */
/* eslint-disable rabaed/no-hardcoded-colour -- drawn into the photo itself, not the page */
export const markColours = [
  { key: "red", value: "#e5322d" },
  { key: "yellow", value: "#ffd400" },
  { key: "blue", value: "#1e6fff" },
  { key: "white", value: "#ffffff" },
  { key: "black", value: "#111111" },
] as const;
/* eslint-enable rabaed/no-hardcoded-colour */
