// The marks drawn on a photo in the annotate view (RP-656): arrows, rectangles,
// circles, freehand pen lines and text labels. A mark is kept in fractions of
// the image (0 to 1 across and down), so it is drawn the same on the screen's
// fitted view and on the photo's own pixels when the annotated copy is saved.
// Drawn in this order, last on top; undo drops the last one.

/** A point on the image, as fractions of its width and height. */
export type Point = { x: number; y: number };

/** The tools of the annotate view. */
export type MarkTool = "arrow" | "rectangle" | "circle" | "pen" | "text";
export const markTools: readonly MarkTool[] = ["arrow", "rectangle", "circle", "pen", "text"];

/** One mark: a shape dragged from one point to another, a pen line, or a text label centred on a point. */
export type Mark =
  | { tool: "arrow" | "rectangle" | "circle"; colour: string; from: Point; to: Point }
  | { tool: "pen"; colour: string; points: Point[] }
  | { tool: "text"; colour: string; at: Point; text: string };

/**
 * The colours to mark with; red, the first, by default. Fixed, not themed: they
 * are drawn into the photo's pixels, which look the same in every theme.
 */
/* eslint-disable rabaed/no-hardcoded-colour -- the marks' colours are drawn into the photo itself, not the page */
export const markColours = [
  { key: "red", value: "#e5322d" },
  { key: "yellow", value: "#ffd400" },
  { key: "blue", value: "#1e6fff" },
  { key: "white", value: "#ffffff" },
  { key: "black", value: "#111111" },
] as const;
/* eslint-enable rabaed/no-hardcoded-colour */
export type MarkColourKey = (typeof markColours)[number]["key"];
const [white, black] = [markColours[3].value, markColours[4].value];

/** A label's direction, from its first letter: Arabic right to left, else left to right. */
export function textDirection(text: string): "rtl" | "ltr" {
  const first = /[\p{L}]/u.exec(text)?.[0] ?? "";
  return /\p{Script=Arabic}|\p{Script=Hebrew}/u.test(first) ? "rtl" : "ltr";
}

/** What drawMarks needs of a 2D canvas context. */
export type MarkPainter = Pick<
  CanvasRenderingContext2D,
  | "strokeStyle"
  | "fillStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "font"
  | "textBaseline"
  | "textAlign"
  | "direction"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "stroke"
  | "fill"
  | "strokeRect"
  | "ellipse"
  | "strokeText"
  | "fillText"
  | "save"
  | "restore"
>;

/** The two ends of an arrow's head at `to`, `length` back along the shaft, 30° either side of it. */
export function arrowHead(from: Point, to: Point, length: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const side = (turn: number): Point => ({ x: to.x - length * Math.cos(angle + turn), y: to.y - length * Math.sin(angle + turn) });
  return [side(-Math.PI / 6), side(Math.PI / 6)];
}

/** Shorter than this, as a fraction of the image, a drag is a tap: no mark. */
const tapLength = 0.01;

/** Whether a finished mark draws anything: a tap or an empty label doesn't. */
export function isMark(mark: Mark): boolean {
  switch (mark.tool) {
    case "pen":
      return mark.points.length > 1;
    case "text":
      return mark.text.trim() !== "";
    default:
      return Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) >= tapLength;
  }
}

/** The text a label's size is set from: the shorter side of the image. */
const labelSize = (width: number, height: number) => Math.max(14, Math.round(Math.min(width, height) * 0.05));

/** Draws `marks` on an image `width` by `height` pixels, in order. */
export function drawMarks(painter: MarkPainter, marks: readonly Mark[], width: number, height: number): void {
  const line = Math.max(2, Math.round(Math.min(width, height) * 0.008));
  const px = (p: Point) => ({ x: p.x * width, y: p.y * height });
  for (const mark of marks) {
    painter.save();
    painter.strokeStyle = mark.colour;
    painter.fillStyle = mark.colour;
    painter.lineWidth = line;
    painter.lineCap = "round";
    painter.lineJoin = "round";
    switch (mark.tool) {
      case "arrow": {
        const [from, to] = [px(mark.from), px(mark.to)];
        const [left, right] = arrowHead(from, to, line * 5);
        painter.beginPath();
        painter.moveTo(from.x, from.y);
        painter.lineTo(to.x, to.y);
        painter.stroke();
        painter.beginPath();
        painter.moveTo(to.x, to.y);
        painter.lineTo(left.x, left.y);
        painter.lineTo(right.x, right.y);
        painter.closePath();
        painter.fill();
        break;
      }
      case "rectangle": {
        const [from, to] = [px(mark.from), px(mark.to)];
        painter.strokeRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
        break;
      }
      case "circle": {
        const [from, to] = [px(mark.from), px(mark.to)];
        painter.beginPath();
        painter.ellipse((from.x + to.x) / 2, (from.y + to.y) / 2, Math.abs(to.x - from.x) / 2, Math.abs(to.y - from.y) / 2, 0, 0, 2 * Math.PI);
        painter.stroke();
        break;
      }
      case "pen": {
        const [first, ...rest] = mark.points.map(px);
        painter.beginPath();
        painter.moveTo(first!.x, first!.y);
        for (const p of rest) painter.lineTo(p.x, p.y);
        painter.stroke();
        break;
      }
      case "text": {
        const at = px(mark.at);
        const size = labelSize(width, height);
        painter.font = `600 ${size}px system-ui, sans-serif`;
        painter.textAlign = "center";
        painter.textBaseline = "middle";
        painter.direction = textDirection(mark.text);
        // A dark or light halo, whichever the colour stands out from, so the label reads on any photo.
        painter.strokeStyle = mark.colour === black ? white : black;
        painter.lineWidth = Math.max(3, Math.round(size / 5));
        painter.strokeText(mark.text, at.x, at.y);
        painter.fillText(mark.text, at.x, at.y);
        break;
      }
    }
    painter.restore();
  }
}

/** A photo's size, made no longer on its long side than `longest` pixels, its proportions kept. */
export function fittedSize(width: number, height: number, longest: number): { width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
