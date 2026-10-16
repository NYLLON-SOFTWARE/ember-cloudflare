# ember-rust's notification setup help

The `.html` files are ember-rust's goldens of its three partials of help with turning notifications on
(`crates/views/templates/pwa/_browser_settings.html`, `_system_settings.html` and
`_install_instructions.html`), from `crates/views/tests/golden/a/` at
[`cfeb4c2`](https://github.com/NYLLON-SOFTWARE/ember-rust/tree/cfeb4c289f9ab3042248777f29a103294ff3de87/crates/views/tests/golden/a),
copied unchanged: what Campfire's Rails views rendered for each of ten user agents. An empty file is a
partial Campfire leaves out for that browser. `platforms.json` holds those user agents, the platform
Rails read from each, and the address the pages were rendered at, cut from the same folder's 2.7 MB
`facts.json` with `jq '{base_url, user_agents, platforms}'`.

`../notification-help.test.tsx` renders the help for each of those platforms and reads it against
them, as ember-rust's `pwa_partials` test (`crates/views/tests/parity_a.rs`) does, reading "Campfire" as
"Ember" as ember-rust does. The Worker reads the platform from the user agent, which
`apps/worker/test/user-agent.test.ts` checks against Rails' answers for 385 user agents, five of these
ten among them.

They're ember-rust's work, under its MIT license, like this repository.
