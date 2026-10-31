// A blocking pause for the clean-up scripts, which run Docker and git synchronously (RP-1170).
const pause = new Int32Array(new SharedArrayBuffer(4));

/** Blocks this thread for ms milliseconds. */
export const sleepSync = (ms: number): void => void Atomics.wait(pause, 0, 0, ms);
