// Comparing folder paths the way git and Docker report them on this machine:
// backslashes or slashes, an optional trailing slash, and on Windows any case.

/** The path with forward slashes and no trailing slash; lowercased on Windows. */
export function normalPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const slashed = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** Whether two paths name the same folder. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return a !== "" && b !== "" && normalPath(a, platform) === normalPath(b, platform);
}
