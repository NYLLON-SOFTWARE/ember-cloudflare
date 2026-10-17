# Recorded link previews

`opengraph_cases.json` and `opengraph_expected.json` are ember-rust's
`crates/ember/src/integrations/testdata/` files at `cfeb4c2`, copied unmodified (MIT, like this
repository). The first describes 90 links and a fake Internet to unfurl them on: DNS answers, and
the responses a server gives at the fake public addresses. The second is what the Rails app ember-rust
ports answered for each, recorded by ember-rust's `testdata/oracle/opengraph.rb`: the response, the
DNS lookups and the requests the server received.

`../unfurl-cases.test.ts` replays them. Where this port answers differently on purpose, it says so
there, case by case.

# A recorded push

`web_push_expected.json` is ember-rust's file of that name in the same directory, at the same
commit, copied unmodified. Its `testdata/oracle/web_push.rb` recorded it from the web-push gem the
Rails app sends pushes with: a browser's keys, a push's message as Rails writes it, the gem's
encryption of it for those keys, and the headers and VAPID token it sends at a fixed time, signed
with the reference test keys in ember-rust's `parity/.env.reference`.

`../web-push.test.ts` checks that a push is written, encrypted and signed as the gem does it.

# Recorded webhook answers

`webhook_cases.json` and `webhook_expected.json` are ember-rust's files of those names in the same
directory, at the same commit, copied unmodified. The first describes 19 answers a bot's webhook can
give: its status, headers and body, gzipped or late. The second is what the Rails app's
`Webhook#deliver` made of each, recorded by ember-rust's `testdata/oracle/webhook.rb`: the request it
sent, the webhook's status, and the text or file the bot said back, or what it raised.

`../webhook-replies.test.ts` replays them. Where this port answers differently on purpose, it says so
there.
