// What the panel shows of a long message or reason until the person presses Show more.

/** A message or a reason longer than this many lines or characters shows its start, with Show more. */
export const PREVIEW_LINES = 6
export const PREVIEW_CHARS = 300

/**
 * The start of a long text: whole lines up to PREVIEW_LINES and PREVIEW_CHARS (a first line longer than that cut
 * inside it), then an ellipsis; a code block left open is closed, so the rest still reads as Markdown. Null when
 * the text is short enough to show whole.
 */
export function preview(text: string): string | null {
  const lines = text.split('\n')
  if (lines.length <= PREVIEW_LINES && text.length <= PREVIEW_CHARS) return null
  const kept: string[] = []
  let length = 0
  for (const line of lines.slice(0, PREVIEW_LINES)) {
    if (kept.length > 0 && length + line.length > PREVIEW_CHARS) break
    kept.push(line)
    length += line.length + 1
  }
  if (kept.length === 1 && kept[0].length > PREVIEW_CHARS) kept[0] = Array.from(kept[0]).slice(0, PREVIEW_CHARS).join('')
  const fenced = kept.filter((line) => /^\s*(```|~~~)/.test(line)).length % 2 === 1
  return fenced ? `${kept.join('\n')}\n\`\`\`\n\n…` : `${kept.join('\n')} …`
}
