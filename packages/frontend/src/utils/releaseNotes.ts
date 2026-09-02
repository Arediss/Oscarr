/**
 * A very small reader for the release-note bodies stored in `Patchnote.bodyEn` / `bodyFr`.
 *
 * Those bodies are written by us, in migrations — nothing else can write to that table, no route
 * and no plugin. That is what makes this safe without a sanitizer: the parser only understands the
 * handful of constructs our own notes use, and the renderer turns them into React elements, so no
 * HTML is ever injected. It also keeps `marked` + `dompurify` (~60 kB) out of a bundle that would
 * carry them for a dialog most users open once per release.
 *
 * Understood: `## heading`, `> callout`, ``` fenced code ```, `- bullets`, blank-line-separated
 * paragraphs, and `**bold**` / `` `code` `` inside a line. Anything else stays literal text.
 */

export interface Span {
  text: string;
  bold?: true;
  code?: true;
}

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'callout'; spans: Span[] }
  | { kind: 'list'; items: Span[][] }
  | { kind: 'code'; text: string };

/** Split a line on **bold** and `code`. An unmatched marker stays literal rather than swallowing
 *  the rest of the line — a note with a stray asterisk should read badly, not disappear. */
function spansOf(line: string): Span[] {
  const spans: Span[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(line)) !== null) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else spans.push({ text: m[2], code: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last) });
  return spans.length > 0 ? spans : [{ text: line }];
}

export function parseReleaseNote(body: string | null | undefined): Block[] {
  if (!body) return [];

  const lines = body.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Span[][] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: spansOf(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push({ kind: 'list', items: list });
    list = [];
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
      // No inline parsing inside a fence: a command is shown exactly as it must be typed.
      blocks.push({ kind: 'code', text: code.join('\n').trim() });
      continue;
    }

    if (trimmed === '') { flush(); continue; }

    if (trimmed.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'heading', text: trimmed.slice(3).trim() });
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flush();
      blocks.push({ kind: 'callout', spans: spansOf(trimmed.slice(2).trim()) });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      flushParagraph();
      list.push(spansOf(trimmed.slice(2).trim()));
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
