/**
 * The messages of `list` under `prefix`, by key, from a namespace's translator `t`:
 * `keys("status", ["open", "done"])` is `{ open: t("status.open"), done: t("status.done") }`.
 * For labels whose keys are a list the domain gives (a status, a refusal, a reason).
 */
export function messageKeys(t: (key: string) => string) {
  return <K extends string>(prefix: string, list: readonly K[]) => Object.fromEntries(list.map((k) => [k, t(`${prefix}.${k}`)])) as Record<K, string>;
}
