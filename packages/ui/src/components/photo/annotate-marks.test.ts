import { describe, expect, it } from "vitest";
import { arrowHead, drawMarks, fittedSize, isMark, markColours, textDirection, type Mark, type MarkPainter } from "./annotate-marks.ts";

/** Records what drawMarks asks of the canvas. */
function recorder() {
  const calls: string[] = [];
  const painter: MarkPainter = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textBaseline: "alphabetic",
    textAlign: "start",
    direction: "inherit",
    beginPath: () => calls.push("beginPath"),
    moveTo: (x, y) => calls.push(`moveTo ${x} ${y}`),
    lineTo: (x, y) => calls.push(`lineTo ${x} ${y}`),
    closePath: () => calls.push("closePath"),
    stroke: () => calls.push(`stroke ${painter.strokeStyle} ${painter.lineWidth}`),
    fill: () => calls.push(`fill ${painter.fillStyle}`),
    strokeRect: (x, y, w, h) => calls.push(`strokeRect ${x} ${y} ${w} ${h}`),
    ellipse: (x, y, rx, ry) => calls.push(`ellipse ${x} ${y} ${rx} ${ry}`),
    strokeText: (text) => calls.push(`strokeText ${text}`),
    fillText: (text, x, y) => calls.push(`fillText ${text} ${x} ${y} ${painter.fillStyle}`),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
  };
  return { painter, calls };
}

const red = markColours[0]!.value;

describe("arrowHead", () => {
  it("points back from the tip on both sides of the shaft", () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(left.x).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6));
    expect(right.x).toBeCloseTo(left.x);
    expect(left.y).toBeCloseTo(-right.y);
    expect(Math.abs(left.y)).toBeCloseTo(10 * Math.sin(Math.PI / 6));
  });
});

describe("drawMarks", () => {
  it("draws on the image's own pixels, from marks kept as fractions of it", () => {
    const { painter, calls } = recorder();
    const marks: Mark[] = [
      { tool: "rectangle", colour: red, from: { x: 0.1, y: 0.2 }, to: { x: 0.5, y: 0.6 } },
      { tool: "circle", colour: red, from: { x: 0.5, y: 0.5 }, to: { x: 0.7, y: 0.6 } },
    ];
    drawMarks(painter, marks, 1000, 500);
    expect(calls).toContain("strokeRect 100 100 400 200");
    // The circle fills the box dragged out, centred in it.
    expect(calls).toContain("ellipse 600 275 100 25");
  });

  it("strokes in the mark's colour, thicker on a bigger image", () => {
    const small = recorder();
    const big = recorder();
    const pen: Mark = { tool: "pen", colour: red, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }] };
    drawMarks(small.painter, [pen], 400, 300);
    drawMarks(big.painter, [pen], 4000, 3000);
    const width = (calls: string[]) => Number(calls.find((c) => c.startsWith("stroke "))!.split(" ")[2]);
    expect(small.calls.find((c) => c.startsWith("stroke "))).toContain(red);
    expect(width(big.calls)).toBeGreaterThan(width(small.calls));
  });

  it("writes a text label with a halo, so it reads on any photo", () => {
    const { painter, calls } = recorder();
    drawMarks(painter, [{ tool: "text", colour: red, at: { x: 0.5, y: 0.5 }, text: "تسرب ماء" }], 800, 600);
    expect(calls.indexOf("strokeText تسرب ماء")).toBeLessThan(calls.findIndex((c) => c.startsWith("fillText تسرب ماء")));
    expect(calls.find((c) => c.startsWith("fillText"))).toBe(`fillText تسرب ماء 400 300 ${red}`);
  });
});

describe("textDirection", () => {
  it("follows a label's first letter", () => {
    expect(textDirection("تسرب at C3")).toBe("rtl");
    expect(textDirection("C3 تسرب")).toBe("ltr");
    expect(textDirection("12 شرخ")).toBe("rtl");
  });
});

describe("isMark", () => {
  it("drops a tap: a shape or line with no length", () => {
    expect(isMark({ tool: "arrow", colour: red, from: { x: 0.5, y: 0.5 }, to: { x: 0.501, y: 0.5 } })).toBe(false);
    expect(isMark({ tool: "arrow", colour: red, from: { x: 0.5, y: 0.5 }, to: { x: 0.6, y: 0.5 } })).toBe(true);
    expect(isMark({ tool: "pen", colour: red, points: [{ x: 0.5, y: 0.5 }] })).toBe(false);
    expect(isMark({ tool: "text", colour: red, at: { x: 0.5, y: 0.5 }, text: "  " })).toBe(false);
  });
});

describe("fittedSize", () => {
  it("keeps a photo's size up to the longest side allowed, and its proportions", () => {
    expect(fittedSize(1200, 900, 4096)).toEqual({ width: 1200, height: 900 });
    expect(fittedSize(8000, 6000, 4000)).toEqual({ width: 4000, height: 3000 });
    expect(fittedSize(3000, 6000, 4000)).toEqual({ width: 2000, height: 4000 });
  });
});
