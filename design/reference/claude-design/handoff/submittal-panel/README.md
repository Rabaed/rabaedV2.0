# Submittal Panel — handoff spec

The right-side slide-over that opens a submittal from **List view** and **Kanban view**. It can be resized, has four size presets, and has collapsible sections. Its layout changes with its width. It works in EN/AR (RTL) and light/dark.

**Files in this package**
- `Submittals List (standalone).html`: a working prototype. Click any row to open the panel.
- `Submittals Kanban (standalone).html`: the same panel opened from the board.
- `source/drawer.js` and `source/drawer.css`: the reference implementation (vanilla JS, about 180 lines). Treat it as the behaviour spec, not as production code.
- `screens/`: reference screenshots of each size.

Use the prototype's behaviour as the source of truth. The rest of this document explains it.

---

## 1. Opening and closing

| Trigger | Result |
|---|---|
| Click a list row (anywhere except the checkbox, row menu or links) | The panel opens on that submittal. The row is highlighted. |
| Click a Kanban card (a click, not a drag) | The panel opens. The card gets a 2px brand outline. |
| Click another row or card while the panel is open | The content swaps in place. There is no close/open animation. |
| `Esc` | Closes the innermost layer first: large viewer → template modal → panel. |
| `↑` / `↓` (focus not in an input) | Previous / next submittal in the **current filtered and sorted list**. |
| ✕ button | Close. |

- The panel sits **over** the list. There is no scrim, so the list stays clickable.
- The panel's position is `inline-end`: right in LTR, **left in RTL**.
- Enter animation: 260ms, `translateX(48px)` → 0, using cubic-bezier(.2,.8,.2,1). This plays only on the first open, not when the content swaps.
- Deep link (used by the prototype frames): `?open=<id>&size=sm|md|lg|full&anat=1&col=all|none&tab=det|chat|int&tpl=1&view=<fileIndex>`.

## 2. Sizes and resizing

| Preset | Width | Glyph fill |
|---|---|---|
| Compact | 440px | 28% |
| **Normal (default)** | 640px | 45% |
| Wide | 960px | 65% |
| Full | to the sidebar edge | 100% |

- **Size switch** in the top bar: four segmented buttons. Each one shows a small rectangle glyph whose inline-end portion is filled. From 880px up, the buttons also show text labels.
- **Drag edge (grip)**: a 14px hit area on the inline-start edge, with a visible 8×44 pill that has 3 dots. On hover it shows a 2px brand line.
  - The width is clamped to `[380, available]`. `available` is the viewport width minus the sidebar edge.
  - It **snaps** to a preset within ±12px, and becomes Full within 24px of the maximum.
  - While dragging, a tooltip shows `640px · Normal`, or the current layout band when the width isn't on a preset.
  - **Double-click** the grip to toggle Normal ↔ Wide.
  - Width transitions are disabled while dragging and on first paint.
- Persist `{w, col, tab, anat}` per user (prototype: `localStorage['rb-drawer-v1']`). Deep-linked or embedded views must **not** write these preferences.

## 3. Layout bands (by the panel's own width, using a container query)

Use **container queries on the panel**, not viewport media queries. The layout has to change live while the user drags.

| Band | Width | Layout |
|---|---|---|
| Compact | < 560 | One pane. Fields stacked in 1 column. Key facts in a 2×2 grid. Prev/next hidden. Viewer has no page thumbnails. Number at 21px. |
| Normal | 560–879 | One pane. Fields in 2 columns. Key facts in 4 columns. Breadcrumb label shown. Footer hint shown. |
| Wide | 880–1159 | **Two panes**: main column and a **300px side rail**. The in-flow "Workflow & approval log" section is hidden because the rail shows it. Number at 32px. |
| Full | ≥ 1160 | Two panes. Rail is 360px. Fields in 3 columns. Main column max width is 1040px. |

## 4. Anatomy (top → bottom)

1. **Resize edge**: see §2.
2. **Top bar** (52px, fixed), from start to end:
   - Breadcrumb `Submittals › TWR-TMC-CV-DAR-282 Rev 1 · 3 / 42`.
   - Prev/next (↑↓).
   - Size switch.
   - Anatomy toggle (ⓘ).
   - Close.
3. **Identity**
   - The **document number** is big, plain and bold: `TWR-TMC-EL-MAR-042`. Sizes are 21, 26 or 32px depending on the band.
   - The revision is appended **inline after the number** in brand orange: `… Rev 1`, `Rev 2`. **Rev 0 shows nothing.** There is no separate revision chip and no "R0".
   - An **ⓘ info icon** sits next to the number. On hover or focus it opens a card titled "How this number is built", containing:
     - The colour-coded number: Project (gray), Company (tomato), Trade (cyan), Work item type (violet), Sequence (ink).
     - One line per segment explaining it, e.g. "TMC — TMC Constructions, the company that raised it".
     - A footnote: "Set by Document Numbering in Settings. The number never changes; revisions add Rev 1, Rev 2…".
     - The colours appear **only inside this card**. The headline number is monochrome.
   - The title (h2), then chips for Status, Code (A–D) and Trade.
4. **Route strip**: four party stops, each with an icon: **Contractor → Consultant → Client → Contractor**.
   - Each stop has a state: done, current or upcoming. The current stop is on a white tile with a brand outline.
   - **The whole strip is a button** that opens the Workflow template modal (§6).
   - Party colours: Contractor is orange (`hammer`), Consultant is blue (`ruler-2`), Client is green (`building`).
5. **Key facts**: Current owner (avatar and name), Due date (red with an alert icon when late), Days at this step (age dots and the count), Location.
   - **Current owner shows at every size.** An earlier version hid it at Wide; that was wrong.
6. **Tabs** (sticky at the top of the scroll area): **Details · Chat (n) · 🔒 Internal communication (n)**.
7. **Section controls**: "7 sections" plus a Collapse all / Expand all button.
8. **Collapsible sections** (Details tab):
   - The header is the full-width button: icon tile, title, a **one-line summary when collapsed**, and a chevron.
   - Each section's collapsed state is remembered across submittals.

   | Key | Section | Collapsed summary |
   |---|---|---|
   | wf | Workflow & approval log (only below 880px) | current step · N log entries |
   | sub | Subject | title |
   | scope | Scope | trade · scopes |
   | loc | Location | Zone A › Building 1 › Floor 3 |
   | sup | Supplier & items | supplier · N items |
   | att | Attachments | N files |
   | lnk | Links & subtasks | N links · x/y done |

9. **Side rail** (Wide and Full): Workflow (route strip and a vertical step list, plus a "Template ↗" link), then the **Approval log**.
10. **Action bar** (fixed footer): a keyboard hint at the start, then actions by status, with the primary action last:
    - draft: Edit · **Send for review**
    - internal: Return · **Sign & submit**
    - pending / resub: Comment · **Issue code**
    - approved: **Download PDF**
    - rejected: Download PDF · **Create revision**

## 5. Approval log vs Internal communication vs Chat

Approval log and Internal communication use the **same timeline component**. Each entry has:
- A status dot: neutral, ok (green), warn (amber) or bad (red).
- The action in bold.
- An avatar with **Name**, plus **Role · [party icon] Company**.
- An optional comment box.
- An optional snag link.
- Date and time.

The list is newest first.

**Approval log**: approval actions only.
- Created → Sent for internal review → Signed & submitted to Consultant → Recommended Code X → Issued Code X → Client approved / acknowledged.
- A comment appears **only if one was written**:
  - The engineer's recommendation text.
  - The manager's code comment. Code A usually has none.
- If issuing the code opened snags, the entry shows a red chip "N comments opened as snags ↗" that links to the Snag List.
- Internal back-and-forth does **not** appear here.

**Internal communication**: the same timeline, visible **only to the viewer's own company**.
- An amber banner at the top: "Internal — only TMC Constructions can see this. Never shown to the Consultant or Client."
- Entries: notes, "Returned to engineer" (with the reason), "Updated & re-sent", "Approved internally", and post-result notes.
- An "Add an internal note…" composer at the bottom.
- **It is not a chat**: no bubbles.

**Chat**: the shared thread between the parties, as message bubbles. Your own messages are on the inline-end side with a tomato tint. Each message shows a party badge. Chat is disabled, with an empty state, until the submittal has been sent to the Consultant.

## 6. Workflow template modal

Opened from the route strip, the "View workflow template" button or the rail's "Template ↗" link.
- Header: "Workflow template", plus `MAR · Standard approval · v3 · used by 42 submittals`.
- A large route strip, then one card per step containing:
  - Step N · Party
  - The step name
  - What happens
  - The roles, with company names
  - Time allowed
  - The current step is outlined and labelled "You are here".
- Footer: "Changes to the template apply to new submittals only." and an **Open in Workflow settings** button.

## 7. Attachments: in-app preview (no pop-up)

- Each file card shows: type tile, file name (LTR), `PDF · 12 pages · 2.4 MB`, and three buttons: **👁 Preview · ↗ Open large · ⬇ Download**.
- **Preview opens inline, directly under the file card, inside the Attachments section.** It spans the grid width and is not a modal. Press 👁 again or ✕ to collapse it.
  - A dark toolbar with:
    - File icon and name.
    - Page `1 / 12`.
    - Zoom − / % / +, in 10% steps.
    - Open large, Download, Print and Close.
  - The body is 360px tall in the Compact band, 440px in Normal and 560px in Wide and Full. It has a **72px page-thumbnail column** (hidden in the Compact band) and a scrollable page area.
  - Images show the photo instead of pages.
  - The active file card gets a brand outline with a tint.
- **Open large** fills the **panel itself** (not the viewport) with a "‹ Back" button, page and zoom controls, and a file switcher strip at the bottom. Esc returns to the panel.
- Never force a download or open a new browser tab to view a file.

## 8. Anatomy overlay (design/QA aid)

The ⓘ toggle in the top bar adds a dashed violet outline and a number badge to each region, plus a legend card. The legend sits outside the panel, or inside it at Full width, and shows the current width and band. This is optional in production. It's useful for QA and onboarding.

## 9. Tokens and rules

- Use DS tokens only: `--ui-surface/-2`, `--ui-border/-2/-strong`, `--ui-text/-2`, `--ui-muted/faint`, `--btn-pri`, `--tone-*-tint/-fg/-solid`, `--status-*-bg/-fg/-dot`, `--font-ui`, `--font-arabic`. Icons are Tabler webfont v3.19 (check that each glyph exists).
- Document numbers are always `dir=ltr`, even in Arabic.
- Radii: 12px for cards and sections, 9px for buttons, 7–8px for chips and tiles.
- Avoid generic class names. The prototype collided with existing `.drw`, `.lc` and `.rs` classes in other modules, so every class uses a prefix (`sdp`, `d*`, `dlg-*`).
- Minimum hit target is 32px on desktop. Use `aria-expanded` on section headers, `role=tablist` on tabs, and `aria-label` on every icon button.

## 10. Acceptance checklist

- [ ] Opens from both a List row and a Kanban card. Clicking another item swaps the content without re-animating.
- [ ] The four presets work, the drag snaps, and double-click toggles. The width persists. RTL mirrors the side.
- [ ] Layout bands change live during the drag, via a container query.
- [ ] Current owner is visible at every size.
- [ ] Big monochrome number, inline "Rev N" (nothing for Rev 0), and the ⓘ hover card with the colour breakdown.
- [ ] The route strip opens the template modal.
- [ ] Every section collapses and shows its summary. Collapse all / Expand all works. The state persists.
- [ ] Tabs are Details / Chat / Internal communication. Internal uses the timeline component, not chat bubbles.
- [ ] The approval log shows only approval actions. Comments appear only when written. The snag chip appears when snags were opened.
- [ ] Attachment preview opens inline under the file. Open large fills the panel. No pop-ups and no new tabs.
- [ ] Esc closes the innermost layer first. ↑/↓ steps through the filtered list.
- [ ] No horizontal scroll in any band.
