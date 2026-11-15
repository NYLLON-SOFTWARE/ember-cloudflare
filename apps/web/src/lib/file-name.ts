/**
 * A file's name in two parts, for showing it on one line: what can be cut short, its stem, and what
 * can't, its extension with the dot before it, so "quarterly-report-final.pdf" can show as
 * "quarterly-rep….pdf". A name with no extension, or only a leading dot, is all stem.
 */
export function nameParts(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? { stem: name, extension: "" } : { stem: name.slice(0, dot), extension: name.slice(dot) };
}
