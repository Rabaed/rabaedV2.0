import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { typeScale } from "../tokens/scales.ts";

// Teach tailwind-merge the Rabaed type scale, so `text-body` is known as a
// font size and is not merged away against colour classes like `text-muted`.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: Object.keys(typeScale) } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
