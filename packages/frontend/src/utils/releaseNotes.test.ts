import { describe, it, expect } from 'vitest';
import { parseReleaseNote } from './releaseNotes';

/**
 * Release bodies are written by us, in migrations — nothing else can write to the Patchnote table.
 * So this parser only has to understand the small subset our own notes use, and the renderer only
 * has to build React elements from it. No HTML is ever injected, which is why no sanitizer is
 * needed and no markdown dependency is pulled into the bundle.
 */
describe('parseReleaseNote', () => {
  it('reads a section heading', () => {
    expect(parseReleaseNote('## Better availability')).toEqual([
      { kind: 'heading', text: 'Better availability' },
    ]);
  });

  it('reads a paragraph', () => {
    expect(parseReleaseNote('Availability can now be decided per media type.')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'Availability can now be decided per media type.' }] },
    ]);
  });

  it('joins wrapped lines into one paragraph', () => {
    const out = parseReleaseNote('Availability can now\nbe decided per media type.');
    expect(out).toEqual([
      { kind: 'paragraph', spans: [{ text: 'Availability can now be decided per media type.' }] },
    ]);
  });

  it('splits paragraphs on a blank line', () => {
    const out = parseReleaseNote('First.\n\nSecond.');
    expect(out).toHaveLength(2);
    expect(out.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('reads a bullet list as one block', () => {
    const out = parseReleaseNote('- one\n- two\n- three');
    expect(out).toEqual([
      {
        kind: 'list',
        items: [
          [{ text: 'one' }],
          [{ text: 'two' }],
          [{ text: 'three' }],
        ],
      },
    ]);
  });

  it('reads a callout', () => {
    expect(parseReleaseNote('> Keep this key safe.')).toEqual([
      { kind: 'callout', spans: [{ text: 'Keep this key safe.' }] },
    ]);
  });

  it('reads a fenced code block verbatim, without inline parsing', () => {
    const out = parseReleaseNote('```bash\nopenssl rand -hex 32\n```');
    expect(out).toEqual([{ kind: 'code', text: 'openssl rand -hex 32' }]);
  });

  it('keeps ** and ` inside a code block as literal text', () => {
    const out = parseReleaseNote('```\n**not bold** `not code`\n```');
    expect(out).toEqual([{ kind: 'code', text: '**not bold** `not code`' }]);
  });

  it('marks bold and code spans inside a paragraph', () => {
    expect(parseReleaseNote('Set **OSCARR_SECRET_KEY** with `openssl`.')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: 'Set ' },
          { text: 'OSCARR_SECRET_KEY', bold: true },
          { text: ' with ' },
          { text: 'openssl', code: true },
          { text: '.' },
        ],
      },
    ]);
  });

  it('leaves an unmatched marker as plain text rather than swallowing the rest', () => {
    expect(parseReleaseNote('A ** dangling marker')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'A ** dangling marker' }] },
    ]);
  });

  it('returns nothing for empty or missing input', () => {
    expect(parseReleaseNote('')).toEqual([]);
    expect(parseReleaseNote(undefined)).toEqual([]);
    expect(parseReleaseNote(null)).toEqual([]);
  });

  it('parses a whole note in order', () => {
    const kinds = parseReleaseNote([
      '## Security',
      '',
      'Credentials are **encrypted**.',
      '',
      '> Keep your key outside your backups.',
      '',
      '```bash',
      'openssl rand -hex 32',
      '```',
      '',
      '- one',
      '- two',
    ].join('\n')).map((b) => b.kind);

    expect(kinds).toEqual(['heading', 'paragraph', 'callout', 'code', 'list']);
  });
});
