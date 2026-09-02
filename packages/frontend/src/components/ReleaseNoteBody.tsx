import { parseReleaseNote, type Span } from '@/utils/releaseNotes';

/**
 * Renders a release-note body as a document rather than a list of cards.
 *
 * Everything is built as React elements — no HTML is injected anywhere, which is what lets this
 * skip a sanitizer entirely. See utils/releaseNotes.ts for why that is safe here.
 *
 * Colour is not a matter of taste here: on the #0a0e17 ground, `ndp-text-dim` measures 3.99:1 and
 * `ndp-accent` 4.32:1, both under the 4.5:1 AA needs for text this size. Body copy uses
 * `ndp-text-muted` (7.60:1) and inline code `ndp-accent-hover` (6.47:1). `ndp-text-dim` is left to
 * the bullet glyphs, which carry no reading.
 */
function Spans({ spans }: Readonly<{ spans: Span[] }>) {
  return (
    <>
      {spans.map((s, i) => {
        const key = `${i}-${s.text}`;
        if (s.bold) return <strong key={key} className="font-semibold text-ndp-text">{s.text}</strong>;
        if (s.code) {
          return (
            <code
              key={key}
              className="px-1.5 py-0.5 mx-px rounded bg-ndp-accent/[0.12] text-ndp-accent-hover text-[0.85em] font-mono whitespace-nowrap"
            >
              {s.text}
            </code>
          );
        }
        return <span key={key}>{s.text}</span>;
      })}
    </>
  );
}

export default function ReleaseNoteBody({ body }: Readonly<{ body: string }>) {
  const blocks = parseReleaseNote(body);
  if (blocks.length === 0) return null;

  return (
    // Long-form prose wants a measure, not the full dialog width: past roughly 70 characters the
    // eye loses the start of the next line.
    <div className="max-w-[64ch]">
      {blocks.map((block, i) => {
        const key = `${block.kind}-${i}`;
        const first = i === 0;

        switch (block.kind) {
          case 'heading':
            return (
              // The accent tick marks where a section starts, using the one colour the dialog
              // already means something with. Space above a heading is larger than space between
              // paragraphs, so the structure is legible before a word is read.
              <h4
                key={key}
                className={`flex items-center gap-2.5 text-[13px] font-semibold text-ndp-text ${first ? '' : 'mt-8'} mb-3`}
              >
                <span aria-hidden="true" className="w-0.5 h-3.5 rounded-full bg-ndp-accent flex-shrink-0" />
                {block.text}
              </h4>
            );

          case 'paragraph':
            return (
              <p key={key} className={`text-[13px] leading-[1.7] text-ndp-text-muted ${first ? '' : 'mt-3'}`}>
                <Spans spans={block.spans} />
              </p>
            );

          case 'callout':
            return (
              // The two things a reader must actually act on. Near-white, so they read as louder
              // than the prose around them rather than merely tinted.
              <p
                key={key}
                className={`text-[13px] leading-[1.7] text-ndp-text border-l-2 border-ndp-accent bg-ndp-accent/[0.07] pl-4 pr-4 py-3 rounded-r-lg ${first ? '' : 'mt-4'}`}
              >
                <Spans spans={block.spans} />
              </p>
            );

          case 'list':
            return (
              <ul key={key} className={`space-y-2 ${first ? '' : 'mt-3'}`}>
                {block.items.map((item, j) => (
                  <li
                    key={`${j}-${item[0]?.text ?? ''}`}
                    className="text-[13px] leading-[1.7] text-ndp-text-muted flex gap-2.5"
                  >
                    <span aria-hidden="true" className="text-ndp-accent/70 select-none leading-[1.7] text-[10px] pt-[3px]">●</span>
                    <span className="min-w-0">
                      <Spans spans={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );

          case 'code':
            return (
              <pre
                key={key}
                className={`text-xs font-mono text-ndp-text-muted bg-black/40 ring-1 ring-white/[0.06] rounded-lg px-4 py-3 overflow-x-auto ${first ? '' : 'mt-3'}`}
              >
                <code>{block.text}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
