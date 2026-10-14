# ember-rust's rich text corpus

`expected.json` is ember-rust's `crates/richtext/tests/corpus/expected.json` at
[`cfeb4c2`](https://github.com/NYLLON-SOFTWARE/ember-rust/blob/cfeb4c289f9ab3042248777f29a103294ff3de87/crates/richtext/tests/corpus/expected.json),
copied unchanged. It holds 658 stored message bodies (Campfire's fixtures, hand-written cases of
Lexxy and Trix markup, attachments, XSS, malformed markup and parser limits, and 400 seeded fuzz
cases) with what Campfire's own Rails pipeline made of each, or the error it raised:

| Field | What Rails made of the body | Read by |
|---|---|---|
| `plain_text` | `message.body.to_plain_text` | `src/corpus.test.ts` |
| `mentioned` | `Message::Mentionee#mentioned_users`, as user ids | `src/corpus.test.ts` |
| `filtered` | `TextMessagePresentationFilters.apply(...)` | `src/corpus.test.ts` |
| `presentation` | `MessagesHelper#message_presentation` | `src/corpus.test.ts` |
| `editable` | The `<lexxy-editor>` value for editing it | nothing yet |

The users, rooms and signed ids the bodies refer to are in the same file.

ember-rust generates it from `crates/richtext/tests/corpus/inputs.yml` with
`reference-tools/richtext/run.sh`, which runs `reference-tools/richtext/generate.rb` in its
`campfire-reference` Docker image. To take a newer one, copy it over this one and run
`pnpm --filter @ember/richtext test`: the corpus test names every case that no longer reads as
Rails did, and every case in `src/testing/known-differences.ts` that now does.

It's ember-rust's work, under its MIT license, which `MIT-LICENSE` copies.
