/**
 * Parse three-line TLE catalog text into `{ name, line1, line2 }` entries.
 * A malformed/short set costs only itself: scanning resumes at the next
 * candidate name instead of shifting every later set out of alignment.
 */
export function parseTleText(text) {
  const lines = String(text)
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    // A TLE line cannot also be the three-line set's name. Skipping it one line
    // at a time lets the parser recover when the preceding set was truncated.
    if (name.startsWith('1 ') || name.startsWith('2 ')) continue;
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (line1?.startsWith('1 ') && line2?.startsWith('2 ')) {
      result.push({ name, line1, line2 });
      i += 2;
    }
  }
  return result;
}

/** The NORAD catalog number from TLE line 1, or null. */
export function tleCatalogNumber(line1) {
  const number = Number.parseInt(String(line1).slice(2, 7), 10);
  return Number.isInteger(number) ? number : null;
}
