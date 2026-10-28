/** A plain left click, which may open the Submittal Panel; one with a modifier keeps the link's own (a new tab or window). */
export function isPlainClick(event: { button: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
