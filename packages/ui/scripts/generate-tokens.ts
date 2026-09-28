import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateTokensCss } from "../src/tokens/generate.ts";

const target = new URL("../src/styles/tokens.css", import.meta.url);
writeFileSync(target, generateTokensCss());
console.log(`Wrote ${fileURLToPath(target)}`);
