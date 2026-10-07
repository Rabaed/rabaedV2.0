import { chainBuckets, codeCStates, type ChainBucket, type CodeCState } from "@rabaed/domain";

/**
 * The names of the chain buckets and Code C states, from a translator scoped to
 * the messages that hold `buckets.*` and `codeCStates.*` (the Dashboard's and
 * the List's both do).
 */
export function chainLabels(t: (key: string) => string): { buckets: Record<ChainBucket, string>; codeCStates: Record<CodeCState, string> } {
  return {
    buckets: Object.fromEntries(chainBuckets.map((b) => [b, t(`buckets.${b}`)])) as Record<ChainBucket, string>,
    codeCStates: Object.fromEntries(codeCStates.map((s) => [s, t(`codeCStates.${s}`)])) as Record<CodeCState, string>,
  };
}
