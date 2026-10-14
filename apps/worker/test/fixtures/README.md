# Recorded link previews

`opengraph_cases.json` and `opengraph_expected.json` are ember-rust's
`crates/ember/src/integrations/testdata/` files at `cfeb4c2`, copied unmodified (MIT, like this
repository). The first describes 90 links and a fake Internet to unfurl them on: DNS answers, and
the responses a server gives at the fake public addresses. The second is what the Rails app ember-rust
ports answered for each, recorded by ember-rust's `testdata/oracle/opengraph.rb`: the response, the
DNS lookups and the requests the server received.

`../unfurl-cases.test.ts` replays them. Where this port answers differently on purpose, it says so
there, case by case.
