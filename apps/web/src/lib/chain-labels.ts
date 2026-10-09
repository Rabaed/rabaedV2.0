import { codeCStates, fixedChainBuckets, type CodeCState, type FixedChainBucket } from "@rabaed/domain";

/**
 * The names of the chain buckets that aren't an outcome (an outcome's bucket is
 * named by its Type's set, RP-429) and of the Code C states, from a translator
 * scoped to the messages that hold `buckets.*` and `codeCStates.*` (the
 * Dashboard's and the List's both do).
 */
export function chainLabels(t: (key: string) => string): { buckets: Record<FixedChainBucket, string>; codeCStates: Record<CodeCState, string> } {
  return {
    buckets: Object.fromEntries(fixedChainBuckets.map((b) => [b, t(`buckets.${b}`)])) as Record<FixedChainBucket, string>,
    codeCStates: Object.fromEntries(codeCStates.map((s) => [s, t(`codeCStates.${s}`)])) as Record<CodeCState, string>,
  };
}
