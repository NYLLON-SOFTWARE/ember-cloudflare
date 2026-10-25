import { SIGN_UP_PATH } from "@ember/protocol";
import type { LinkSharing } from "./link-buttons";

// The join link, which ember-rust's invite block on workspace settings
// (crates/views/templates/accounts/_invite.html) and the welcome card (rooms/show/_invitation.html)
// both hand on with the same buttons, as Membership hands on open sign-up's page.

/** The join link for `joinCode`, absolute, as ember-rust writes it (`ctx.url`). */
export const joinUrl = (joinCode: string) => new URL(`/join/${joinCode}`, location.origin).href;

/** What the join link's buttons are called, and what sharing it sends. */
export const JOIN_LINK: LinkSharing = {
  qrCodeLabel: "Show join link QR code",
  copyLabel: "Copy join link",
  shareLabel: "Share join link",
  title: "Link to join Ember",
  text: "Hit this link to join me in Ember and start chatting.",
};

/** Open sign-up's page, absolute, where anyone may create an account while Open is on. */
export const signUpUrl = () => new URL(SIGN_UP_PATH, location.origin).href;

/** What open sign-up's link's buttons are called, and what sharing it sends, as the join link does. */
export const SIGN_UP_LINK: LinkSharing = {
  ...JOIN_LINK,
  qrCodeLabel: "Show sign-up link QR code",
  copyLabel: "Copy sign-up link",
  shareLabel: "Share sign-up link",
};
