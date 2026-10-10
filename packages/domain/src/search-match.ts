/**
 * A list's own search box, filtered in the browser (the Members page, the Projects page, a filter
 * panel's values): whether any of a row's texts contains the words, whatever their case, the
 * spaces around them ignored. An empty box matches every row. Not the List's search, which the
 * API runs (`app.search_work_items`).
 */
export function matchesSearch(words: string | undefined, texts: readonly string[]): boolean {
  const needle = (words ?? "").trim().toLocaleLowerCase();
  return needle === "" || texts.some((text) => text.toLocaleLowerCase().includes(needle));
}
