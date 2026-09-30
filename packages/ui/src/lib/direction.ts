/** A side that follows the reading direction: start is the left in English, the right in Arabic. */
export type LogicalSide = "start" | "end";

/** The physical side a logical one lands on, for Radix APIs that only take left or right. */
export function physicalSide(side: LogicalSide, dir: "ltr" | "rtl"): "left" | "right" {
  return (side === "start") === (dir === "ltr") ? "left" : "right";
}
