/**
 * Glob Matcher
 *
 * Pattern matching for policy rule action type scoping.
 * Supports `*` (single segment), `**` (any depth), and literal matches.
 *
 * Examples:
 *   `finance.*`     matches `finance.delete`, `finance.create`
 *   `*.delete`      matches `finance.delete`, `hr.delete`
 *   `**`            matches everything
 *   `finance.delete` matches only `finance.delete`
 */

export function globToRegex(pattern: string): RegExp {
  // Split on `**` first (multi-segment wildcard), then escape and
  // convert single `*` within each segment independently.
  const segments = pattern.split('**');
  const regexParts = segments.map((segment) =>
    segment
      .replace(/[.+^${}()|\\[\]]/g, '\\$&')  // escape regex special chars
      .replace(/\*/g, '[^.\\n]*'),            // `*` -> single segment (no dots, no newlines)
  );
  // `**` joins as `.*`, which (no `m`/`s` flag) already excludes newlines. With
  // the ^…$ anchors a newline embedded in an action type can never let it
  // partially match or evade a deny pattern.
  return new RegExp('^' + regexParts.join('.*') + '$');
}

export function globMatches(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}
