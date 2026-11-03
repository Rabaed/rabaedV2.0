// The Form's unsaved state (WorkItemFormProvider), apart from React so it is tested on its own
// (RP-1221, UAT J9). The answers are one object, replaced on every change, so "typed since" is
// "not the object that was sent".

/**
 * Whether anything is unsaved once the answers `sent` were saved, by the provider's own PUT or by
 * the New item panel's create: only what was typed since. Never true for answers nobody changed,
 * so autosave never re-sends them over an edit made meanwhile elsewhere.
 */
export function unsavedAfterSave(current: object, sent: object): boolean {
  return current !== sent;
}

/** Autosave runs only where it is on (a first Draft), the Form editable, something unsaved, and no save already out. */
export function autosavesNow({ autosave, editable, dirty, pending }: { autosave: boolean; editable: boolean; dirty: boolean; pending: boolean }): boolean {
  return autosave && editable && dirty && !pending;
}
