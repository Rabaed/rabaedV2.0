/**
 * The 44px touch-target measure, shared by `expectTouchTarget` (one control, in a
 * play function) and the story harness (every interactive element of a phone story).
 */

/** What the harness treats as interactive. */
export const interactiveSelector = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=combobox]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=option]",
  "[role=slider]",
  "[role=spinbutton]",
  "[role=textbox]",
].join(",");

/**
 * Exemptions from the harness check, with a reason each. Keep this short.
 * - An inline text link (an `a` in a run of text: text of its own beside it, in its parent
 *   or in the inline elements around it up to the text block) is exempt automatically:
 *   WCAG 2.5.8 exempts targets inline in a sentence. A link beside a badge or an icon is not.
 * - Anything else: a story lists `parameters.touchTargets.exempt`, each entry a CSS
 *   `selector` and the `reason` it cannot reach 44px.
 */
export type TouchTargetExemption = { selector: string; reason: string };

/**
 * Null when the element's touch target is at least 44px across both ways: its own box, or for
 * a smaller control a hit area that reaches 22px from its centre in all four directions
 * (e.g. a pseudo-element). Edge midpoints, not corners, so rounded corners don't count against it.
 * Where a probe would fall off the screen (a control at its edge), the control's own box must
 * reach that far instead: a hit area past the edge can't be tapped.
 * Otherwise a short description of the shortfall.
 */
export function touchTargetShortfall(control: Element): string | null {
  let box = control.getBoundingClientRect();
  if (box.width >= 44 && box.height >= 44) return null;
  // elementFromPoint sees only the viewport: bring the control into it (callers restore the scroll).
  control.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  box = control.getBoundingClientRect();
  const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
  const reach = 21.5;
  const misses: string[] = [];
  for (const [dx, dy, side] of [[-reach, 0, "start"], [reach, 0, "end"], [0, -reach, "top"], [0, reach, "bottom"]] as const) {
    if (x + dx < 0 || y + dy < 0 || x + dx >= innerWidth || y + dy >= innerHeight) {
      const own = dx !== 0 ? box.width / 2 : box.height / 2;
      if (own < reach) misses.push(`${side}: at the screen edge, its own box reaches ${Math.round(own)}px`);
      continue;
    }
    const hit = document.elementFromPoint(x + dx, y + dy);
    if (!hit || !(control.contains(hit) || labelledBy(control, hit))) misses.push(`${side}: ${hit ? describe(hit) : "nothing"}`);
  }
  return misses.length === 0 ? null : `${Math.round(box.width)}x${Math.round(box.height)}px, hit area stops short (${misses.join("; ")})`;
}

// A native input is activated through its label too.
function labelledBy(control: Element, hit: Element) {
  const labels = (control as HTMLInputElement).labels;
  return !!labels && Array.from(labels).some((label) => label.contains(hit));
}

function describe(element: Element) {
  const name = element.getAttribute("aria-label") ?? element.id ?? "";
  return `<${element.tagName.toLowerCase()} ${element.getAttribute("role") ?? ""} ${name}> ${element.textContent?.slice(0, 30) ?? ""}`;
}

/**
 * An `a` in a run of text: a text node of its own beside it, in its parent or in an inline
 * element around it (`<p>Read the <strong><a>terms</a></strong> first</p>`), up to the first
 * block. Elements beside it (a badge, an icon) don't count: that is a row, not a sentence.
 */
function isInlineTextLink(element: Element) {
  if (element.tagName !== "A") return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (Array.from(parent.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "")) return true;
    if (getComputedStyle(parent).display !== "inline") return false;
  }
  return false;
}

function visible(element: Element) {
  if (element.closest("[aria-hidden=true], [hidden], [inert]")) return false;
  // The content of a closed <details> is not rendered (only its <summary> is).
  const closed = element.closest("details:not([open])");
  if (closed && !element.closest("summary")?.parentElement?.isSameNode(closed)) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

function accessibleName(element: Element) {
  const labelledby = element.getAttribute("aria-labelledby")?.split(" ").map((id) => document.getElementById(id)?.textContent?.trim()).join(" ").trim();
  const label = (element as HTMLInputElement).labels?.[0]?.textContent?.trim();
  return (element.getAttribute("aria-label") || labelledby || label || element.textContent?.trim() || "").slice(0, 60);
}

/** Every interactive element under `root` that is under 44px, named by role and accessible name. */
export function touchTargetOffenders(root: ParentNode, exempt: readonly TouchTargetExemption[] = []): string[] {
  const offenders: string[] = [];
  for (const element of root.querySelectorAll(interactiveSelector)) {
    if (!visible(element) || isInlineTextLink(element)) continue;
    if (exempt.some(({ selector }) => element.matches(selector))) continue;
    const shortfall = touchTargetShortfall(element);
    if (shortfall) {
      const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
      const name = accessibleName(element);
      offenders.push(`${role} "${name}": ${shortfall}`);
    }
  }
  return offenders;
}
