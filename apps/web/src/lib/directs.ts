import type { DirectRoom, Room, User, UserId } from "@ember/protocol";

/**
 * Names in a sentence, as Rails' `to_sentence` joins them for a DM's name (ember-rust's
 * `h::to_sentence`, crates/views/src/helpers/application.rs): "Ada", "Ada and Grace", or
 * "Ada, Grace, and Alan".
 */
export function toSentence(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/**
 * Who a DM shows the person `meId` signs in: the others in it, or just them in their DM with
 * themselves, as ember-rust's sidebar row and settings page list them (`sidebar_direct`,
 * presenters/accounts.rs, and `directs#edit`, rooms/directs.rs).
 */
export function membersShown(room: DirectRoom, meId: UserId): User[] {
  const others = room.members.filter((member) => member.id !== meId);
  return others.length > 0 ? others : room.members;
}

/**
 * A room's name as the person `meId` reads it, as ember-rust's `room_display_name` gives it
 * (crates/views/src/rooms.rs): a shared room's own, and a DM's others' names in a sentence, or their
 * own in their DM with themselves. `nameOf` gives each person's name as it is now.
 */
export function roomName(room: Room, meId: UserId, nameOf: (user: User) => string): string {
  return room.kind === "direct" ? toSentence(membersShown(room, meId).map(nameOf)) : room.name;
}
