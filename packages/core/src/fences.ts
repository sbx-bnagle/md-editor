// Fenced code, as CommonMark reads it: a line of three or more backticks or tildes opens a fence
// (a backtick fence's info string has no backticks), and only a line of the same character, at
// least as long and with nothing after it, closes it. "```js" inside a fence is text.

/** The fence a line opens, or null. */
export function openingFence(line: string): string | null {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  return m[1];
}

/** Whether `line` closes a fence opened with `fence`. */
export function isClosingFence(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length;
}
