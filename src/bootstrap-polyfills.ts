// Must be the very first import in main.ts, before any transitive import
// touches pdfkit/fontkit: pkg's bundled Node binary ships "small-icu",
// which throws on `new TextDecoder('ascii')` - fontkit constructs one at
// module-load time (see node_modules/fontkit/dist/main.cjs), so simply
// requiring pdfkit crashes the whole app under the packaged .exe.
// ASCII is a strict subset of UTF-8 (bytes 0-127 decode identically), so
// substituting 'utf-8' for an 'ascii'/'us-ascii' label is behaviorally
// exact, not an approximation.
const OriginalTextDecoder = TextDecoder;

class PatchedTextDecoder extends OriginalTextDecoder {
  constructor(...args: ConstructorParameters<typeof OriginalTextDecoder>) {
    const [label, options] = args;
    if (label && /^(ascii|us-ascii)$/i.test(label)) {
      super('utf-8', options);
    } else {
      super(...args);
    }
  }
}

(global as unknown as { TextDecoder: unknown }).TextDecoder =
  PatchedTextDecoder;
