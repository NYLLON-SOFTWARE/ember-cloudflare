// `String#all_emoji?` (reference/lib/rails_ext/string.rb, ember-rust's
// crates/ember/src/controllers/presenters.rs): a message or boost of nothing but emoji shows large.

const ALL_EMOJI = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F)+$/u;

/**
 * Whether the text is one or more emoji and nothing else. Skin tones, flags, ❤️, © and ™ count, but
 * a zero-width joiner (in families, say) or a keycap's digit doesn't.
 */
export function isAllEmoji(text: string): boolean {
  return ALL_EMOJI.test(text);
}
