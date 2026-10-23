// The wire protocol shared by the browser and the Worker: the room socket's frames, each one JSON
// object with a `type`, and what the API sends and takes. Keep this file dependency-free: the
// worker and the web app both import it directly as TypeScript.

import type { Card } from "./cards.ts";
import type { StoredFile } from "./files.ts";
import { MAX_ID_LENGTH } from "./pages.ts";
import { MAX_PUSH_ENDPOINT_LENGTH } from "./push.ts";
import { ROOM_ICON_NAMES } from "./room-icons.ts";

export { ROOM_ICON_NAMES };
export {
  AVATAR_BOX,
  AVATAR_PATH,
  AVATAR_TOO_LARGE,
  avatarColor,
  avatarSvg,
  crc32,
  initials,
  LOGO_BOXES,
  LOGO_PATH,
  LOGO_TOO_LARGE,
  MAX_AVATAR_SIZE,
  MAX_LOGO_SIZE,
} from "./avatars.ts";
export {
  MAX_CARDS,
  parseCards,
  parseParts,
  showsAnything,
  type Card,
  type CardAddress,
  type CardButton,
  type CardColumn,
  type CardContextItem,
  type CardField,
  type CardImage,
  type CardPart,
  type CardTile,
} from "./cards.ts";
// The rest of bots.ts is imported from "@ember/protocol/bots": only the bot pages and the Worker's bot API use it,
// and the web app's main chunk, which imports this, would otherwise cost the app one more script to load
// (`oneAppScript` in apps/web/vite.config.ts says why).
export type { Bot, BotAnswer, BotChanges, BotRoom, Bots, BotSettings, NewBot } from "./bots.ts";
export {
  FILE_NAME_NOT_KEPT,
  FILE_TOO_LARGE,
  isKeepableFileName,
  isPreviewed,
  isVariable,
  isWebImage,
  MAX_FILE_NAME_LENGTH,
  MAX_FILE_SIZE,
  MAX_FILE_TYPE_LENGTH,
  MAX_PREVIEW_SIZE,
  parseNewUpload,
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_WIDTH,
  uploadPartPath,
  uploadPreviewPath,
  uploadsPath,
  type NewUpload,
  type StoredFile,
  type Upload,
} from "./files.ts";
export {
  BOTS_PATH,
  CUSTOM_STYLES_PATH,
  isAppPage,
  KIND_SEGMENTS,
  MAX_ID_LENGTH,
  NEW_BOT_PATH,
  NEW_DIRECT_PATH,
  PROFILE_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  SEARCHES_PATH,
  TRANSFER_PATH,
  transferLink,
  WORKSPACE_SETTINGS_PATH,
  workspacePageOf,
  type RoomAccess,
  type WorkspacePage,
} from "./pages.ts";
export {
  MAX_PUSH_ENDPOINT_LENGTH,
  MAX_PUSH_KEY_LENGTH,
  MAX_PUSH_SUBSCRIPTIONS,
  parsePushSubscription,
  signOutEndpointOf,
  type PushSubscriptionKeys,
  type PushSubscriptions,
  type PushSubscriptionSave,
  type SavedPushSubscription,
  type SignOut,
} from "./push.ts";
export { TRANSLATIONS, type TranslationKey } from "./translations.ts";
export {
  isSearchable,
  MAX_SEARCH_LENGTH,
  parseSearch,
  RECENT_SEARCHES,
  sanitizeSearch,
  SEARCH_LIMIT,
  SEARCH_TOO_LONG,
  searchPath,
  searchTerms,
  type SearchResults,
} from "./search.ts";

export type UserId = string;
export type RoomId = string;

export interface User {
  id: UserId;
  name: string;
}

/** Who's signed in, as the app keeps them: someone, and whether they're one of the workspace's administrators. */
export interface Me extends User {
  administrator: boolean;
}

/** What someone is in the workspace: ember-rust's user roles (crates/db/src/models/user.rs). */
export type Role = "member" | "administrator" | "bot";

/** Whether someone can still sign in: people who were removed are deactivated, and banned people are banned. */
export type UserStatus = "active" | "deactivated" | "banned";

/** Someone as the people directory lists them. */
export interface DirectoryUser extends User {
  /** What they say about themselves, or null when they haven't said. */
  bio: string | null;
  role: Role;
  status: UserStatus;
  /** Their avatar, `/users/<token>/avatar?v=<version>`, whose address changes whenever they do. */
  avatarUrl: string;
}

/** What `GET /api/users` answers: everyone in the workspace, deactivated and banned people too. */
export interface Directory {
  users: DirectoryUser[];
}

export type RoomKind = "open" | "closed" | "direct";

/** A room's icon: the name of one of the Lucide icons in ember-rust's catalog. */
export type RoomIconName = (typeof ROOM_ICON_NAMES)[number];

/**
 * A room's icon as New room and a room's settings send it, as ember-rust's forms send `room[icon]`:
 * an icon's name, or "" for the default `#`.
 */
export type RoomIconChoice = RoomIconName | "";

/** An open or a private room, which ember-rust calls a shared room (users/sidebars/rooms/_shared.html). */
export interface SharedRoom {
  id: RoomId;
  kind: Exclude<RoomKind, "direct">;
  name: string;
  /** Null for the default `#`. */
  icon: RoomIconName | null;
}

/**
 * A direct message. It has no name or icon of its own: it's named after its members, who are the same
 * for as long as it lasts, as in ember-rust.
 */
export interface DirectRoom {
  id: RoomId;
  kind: "direct";
  /** Everyone in it, whoever's reading included, by id, with the names they had when it was read. */
  members: User[];
  /** When its latest message came, or when it started, until one has, as an ISO time, which DMs are listed by, latest first. */
  activeAt: string;
}

/** A room someone is in, as their room list shows it: a shared room, or a DM. */
export type Room = SharedRoom | DirectRoom;

/**
 * The welcome card's invitation: the workspace's first room, where the card shows while the room is
 * new, and the code in the workspace's join link, such as aB3d-Ef5h-iJ7k. Only administrators are
 * given it, until they dismiss the card.
 */
export interface Invitation {
  roomId: RoomId;
  joinCode: string;
}

/**
 * How much someone hears of a room they're in, its notification level, as ember-rust's memberships'
 * `involvement` has it (membership.rs): its @mentions of them, all its messages, nothing, or nothing
 * with the room hidden from their sidebar.
 */
export const INVOLVEMENTS = ["mentions", "everything", "nothing", "invisible"] as const;
export type Involvement = (typeof INVOLVEMENTS)[number];

/** The level someone starts at in `room`, as ember-rust grants it: all messages in a DM, and @mentions elsewhere. */
export const startingInvolvement = (room: Room): Involvement => (room.kind === "direct" ? "everything" : "mentions");

/**
 * A room in someone's sidebar, with whether a message has come since they last had it open in a shown
 * tab, which marks it unread for them until they do again, and their level in it. A room they've
 * hidden is listed too, since they can still open it, but their sidebar leaves it out.
 */
export type SidebarRoom = Room & { unread: boolean; involvement: Involvement };

/**
 * The rooms someone has starred, which their sidebar lists first, in the order they starred them, as
 * ember-rust's `favorite_channels` keeps them (account.rs). `version` counts the changes to them, so
 * of two lists, the newer is the one with the larger version, whichever arrives last.
 */
export interface Favorites {
  rooms: RoomId[];
  version: number;
}

/**
 * What `GET /api/sidebar` answers: the rooms someone is in, in the order they were made, the ones
 * they've starred, the invitation, when they're an administrator in its room who hasn't dismissed the
 * card, and the people suggested for DMs. It comes with an ETag, and a request whose If-None-Match
 * names it gets 304 Not Modified instead.
 */
export interface Sidebar {
  rooms: SidebarRoom[];
  favorites: Favorites;
  /**
   * The rooms in `rooms` that the workspace's shared order ranks, in that order, which the sidebar lists
   * after the stars, before the rest, as ember-rust's `channel_order` has them (users/sidebars.rs). An
   * administrator sets it on workspace settings, and the ids of rooms someone isn't in never reach them.
   */
  sharedOrder: RoomId[];
  invitation: Invitation | null;
  /**
   * People to start a DM with, as ember-rust's sidebar suggests them after the DMs
   * (`find_direct_placeholder_users`, controllers/presenters/accounts.rs): the active people with the
   * oldest accounts who share no DM with this person, never them, as many as `suggestedCount` says.
   */
  suggestions: User[];
}

/** How many people the sidebar's suggestions start from, ember-rust's `DIRECT_PLACEHOLDERS`. */
export const SUGGESTED_PEOPLE = 20;

/**
 * How many people the sidebar suggests for DMs to someone with `peopleInDirects` people across their
 * DMs, them included, as ember-rust counts them: `SUGGESTED_PEOPLE` less those people, less one more,
 * so 19 with no DMs, 18 with only a DM with themselves and 17 with a DM with one other person.
 */
export const suggestedCount = (peopleInDirects: number) => Math.max(0, SUGGESTED_PEOPLE - peopleInDirects - 1);

/**
 * A room to create: an open room takes in everyone, and a closed one only the people `memberIds` names.
 * Without an icon, it has the default `#`.
 */
export type NewRoom = { name: string; icon?: RoomIconChoice } & ({ kind: "open" } | { kind: "closed"; memberIds: UserId[] });

/** Someone active, as a room's settings list them, with whether they're in the room. */
export interface RoomPerson extends User {
  member: boolean;
}

/** What `GET /api/rooms/new` answers for the New room forms: everyone active, by name. */
export interface NewRoomForm {
  people: User[];
}

/**
 * A DM to start, as ember-rust's `user_ids[]` names its people: the DM between you and them, whom
 * `userIds` names, or your DM with yourself when it names nobody else.
 */
export interface NewDirect {
  userIds: UserId[];
}

/** What `POST /api/directs` answers: the DM, 201 Created when it's new and 200 OK when the group had one. */
export interface StartedDirect {
  room: DirectRoom;
}

/** What `GET /api/rooms/<id>/settings` answers for a room's settings page. DMs have none. */
export interface RoomSettings {
  room: SharedRoom;
  /** Whether you can change the room, as administrators and its creator can. Others see it read-only. */
  canAdminister: boolean;
  /** Everyone active, by name. */
  people: RoomPerson[];
}

/**
 * What `PATCH /api/rooms/<id>` changes in a room, as its settings save it: its name, its icon, and who
 * it's for, everyone or just the people `memberIds` names, which takes anyone else out of it.
 */
export type RoomChanges = { name?: string; icon?: RoomIconChoice } & ({ kind?: "open" } | { kind: "closed"; memberIds: UserId[] });

/** The workspace, which first run creates, as every page shows it. */
export interface Account {
  name: string;
  /** Whether the translation buttons by fields are hidden, as they are until an administrator shows them. */
  hideTranslationButtons: boolean;
  /** The CSS administrators add to every page, after the app's own. Empty when there's none. */
  customStyles: string;
  /** Whether only administrators can create rooms, as "Must be admin to create new rooms" says. Off until one turns it on. */
  restrictRoomCreation: boolean;
  /**
   * The address of the workspace's logo, which changes whenever the account does, as ember-rust's
   * `fresh_account_logo_path` makes it, or null while there's none, when pages show Ember's flame.
   */
  logo: string | null;
  /**
   * The address an administrator gave Ember in Workspace settings: a host, with its port where it isn't
   * the scheme's own, as `location.host` writes it. Pages opened at any other address move there, but
   * workspace settings. Null while Ember has none, and is used wherever it's opened.
   */
  customDomain: string | null;
}

/** What `GET /api/account` answers for workspace settings. */
export interface WorkspaceSettings {
  account: Account;
  /** The join link's code, which everyone in the workspace can share. */
  joinCode: string;
  /** Whether you can change the workspace, as administrators can. Members see it read-only. */
  canAdminister: boolean;
}

/** What `POST /api/account/join_code` answers: the join link's new code, which the old one no longer joins with. */
export interface NewJoinCode {
  joinCode: string;
}

/**
 * What `PATCH /api/account` changes, as workspace settings save it: the workspace's name, its settings,
 * and its custom domain, which can only be the address the request comes to, or null for none.
 */
export interface AccountChanges {
  name?: string;
  settings?: AccountSettings;
  customDomain?: string | null;
}

/** The workspace's settings that workspace settings' switches change, each as ember-rust's `account[settings]` names it. */
export interface AccountSettings {
  hideTranslationButtons?: boolean;
  restrictRoomCreation?: boolean;
}

/** What `GET /api/account/custom_styles` answers, and `PATCH` sets, as the Custom CSS page saves it. */
export interface CustomStyles {
  customStyles: string;
}

/** The roles an administrator can give someone with the crown on workspace settings. Bots stay bots. */
export type PersonRole = Exclude<Role, "bot">;

/** What `PATCH /api/account/users/<id>` sets, as the crown on workspace settings does: someone's role. */
export interface RoleChange {
  role: PersonRole;
}

/**
 * What `PATCH /api/account/users/<id>` answers, and `DELETE`, which removes them from the workspace, and
 * `POST` and `DELETE /api/users/<id>/ban`, which ban them and lift it: the person as the people
 * directory now lists them.
 */
export interface ChangedPerson {
  user: DirectoryUser;
}

/** Someone as their page shows them: as the people directory lists them, and to administrators with their email address. */
export interface Person extends DirectoryUser {
  /** Their email address, or null when they have none, which only administrators are told. */
  emailAddress?: string | null;
}

/** What `GET /api/users/<id>` answers: anyone, whatever their status. */
export interface PersonAnswer {
  person: Person;
  /**
   * The id in a new sign-in link for them (`transferLink`), which administrators are given for anyone
   * active who isn't a bot, as ember-rust's page shows them it.
   */
  transferId?: string;
}

/** You, as your profile shows you. */
export interface Profile {
  name: string;
  /** Null for someone who signed in with just a name, or who took theirs out. */
  emailAddress: string | null;
  /** What you say about yourself, or null when you haven't said. */
  bio: string | null;
  /** Your avatar, as the people directory gives it (`DirectoryUser.avatarUrl`). */
  avatarUrl: string;
  /** Whether you've uploaded an avatar, which Remove avatar takes away, though one that can't be resized shows your initials. */
  avatar: boolean;
  /** Whether you have a password, which changing your email address or password then asks for (`currentPassword`). */
  password: boolean;
}

/** What `GET /api/users/me/profile` answers, and `PATCH` once it has saved. */
export interface ProfileAnswer {
  profile: Profile;
  /** The id in a new sign-in link for you (`transferLink`), as each of ember-rust's profile pages shows a new one. */
  transferId: string;
}

/**
 * What `PATCH /api/users/me/profile` changes, as the profile's form saves it. What's left out stays as
 * it is, and so does the password when it's blank.
 */
export interface ProfileChanges {
  name?: string;
  emailAddress?: string;
  password?: string;
  bio?: string;
  /** The password you have, which changing your email address or password needs while you have one. */
  currentPassword?: string;
  /**
   * The endpoint of this browser's push subscription, which a new password keeps while it forgets your
   * others, as signing out names the one it forgets (`SignOut`).
   */
  pushSubscriptionEndpoint?: string;
}

/** Whom the sign-in page offers to email for help: the workspace's first administrator. */
export interface HelpContact {
  name: string;
  emailAddress: string;
}

/** What the Set up Ember form shows in its Name and Email address fields while they're empty. */
export interface SetupPlaceholders {
  name: string;
  emailAddress: string;
}

/**
 * How setup can be reached from where the app runs: with the deploy's setup link, which ends in the
 * deployment's `EMBER_SETUP_TOKEN` secret; open to whoever is here, over loopback, where `wrangler dev`
 * serves, while no token is set; or closed until a deploy, or `wrangler secret put EMBER_SETUP_TOKEN`,
 * gives the deployment a token.
 */
export type SetupAccess = "link" | "open" | "closed";

/** What the app asks first (`GET /api/bootstrap`): whether Ember is set up, and who this browser is signed in as. */
export interface Bootstrap {
  /** "pending" until first run creates the workspace and its first administrator. */
  setup: "pending" | "complete";
  /** What setting Ember up takes from here, while it's pending. */
  setupAccess: SetupAccess;
  /**
   * What the Set up Ember form suggests: Kevin Rose's name and email address, unless the deployment names
   * its own with `EMBER_SETUP_NAME_PLACEHOLDER` and `EMBER_SETUP_EMAIL_PLACEHOLDER`.
   */
  setupPlaceholders: SetupPlaceholders;
  /** Whether people may sign in with just a name (`EMBER_GUEST_SIGN_IN`). */
  guestSignIn: boolean;
  /** "Ember" before setup, as in ember-rust. */
  account: Account;
  /** Null until there's an administrator. */
  helpContact: HelpContact | null;
  /** This deployment's version: `APP_VERSION`, else `GIT_REVISION`, else the release. */
  version: string;
  /**
   * The public key browsers subscribe to push notifications with, in URL-safe Base64, or null while Web
   * Push is off, as ember-rust's `vapid-public-key` meta tag carries it.
   */
  vapidPublicKey: string | null;
  /** The browser and system that asked, which choose the steps the notification setup help gives. */
  platform: Platform;
  user: Me | null;
}

/**
 * A browser and the system it runs on, as ember-rust's `ApplicationPlatform` reads them from the user
 * agent with its port of the `useragent` gem, so Chromium Edge and Brave count as Chrome, for instance.
 */
export interface Platform {
  /** An iPhone or an iPad, though iPadOS Safari says it's a Mac. */
  ios: boolean;
  android: boolean;
  /** Neither an iPhone, an iPad nor Android. */
  desktop: boolean;
  windows: boolean;
  /** Chrome, or a browser that says it is, such as Chromium Edge, Brave, and Chrome on iPhone and iPad. */
  chrome: boolean;
  /** Firefox, but for Firefox on iPhone and iPad, which counts as Safari. */
  firefox: boolean;
  safari: boolean;
  /** Edge before it was built on Chrome. */
  edge: boolean;
  /** The browser's name, such as "Chrome", or "" when none can be read. */
  browser: string;
  /** The system's name, such as "macOS", "Windows", "iPhone", "Android" or "Linux", or "" when none can be read. */
  operatingSystem: string;
}

/**
 * Someone new with an email address and password: the workspace's first administrator, as the Set up
 * Ember form sends them to `POST /api/first_run`, or someone joining, as the join form sends them to
 * `POST /api/join/<code>`.
 */
export interface SignUp {
  name: string;
  emailAddress: string;
  password: string;
}

/**
 * Whose password to reset, and to what, as `POST /api/recovery/reset-password` takes it from
 * apps/worker/scripts/reset-password.ts, where ember-rust's `reset-password` takes the address as its
 * argument and the password on stdin.
 */
export interface PasswordReset {
  emailAddress: string;
  password: string;
}

/** What `POST /api/first_run` answers: the administrator it signed in, and general, which opens first. */
export interface NewWorkspace {
  user: Me;
  room: SharedRoom;
}

/** Signing in with an email address and password (`POST /api/session`). */
export interface PasswordSignIn {
  emailAddress: string;
  password: string;
}

/** Signing in with a sign-in link (`POST /api/session/transfers`): its id, which the link's address keeps out of every request's. */
export interface LinkSignIn {
  transferId: string;
}

/** What `POST /api/unfurl` answers for a link with a preview. A link without one gets 204. */
export interface LinkPreview {
  title: string;
  /** The page's og:url when that's a public http(s) URL, else the link that was sent. */
  url: string;
  /** The page's og:image when a HEAD for it answers a JPEG, PNG, GIF or WebP content type. */
  image: string | null;
  description: string;
}

/** ember-rust's one answer to a sign-in it refuses, for a wrong password and too many attempts alike. */
export const SIGN_IN_REFUSED = "Too many requests or unauthorized.";

/**
 * What a room closes a socket with when access to it ends, where ember-rust sends a `disconnect`
 * frame saying whether to reconnect (crates/ember/src/channels/revocation.rs). A close code says the
 * same and can't go missing, as a frame sent just before the close can.
 */
export const CloseCode = {
  /**
   * Connect again: this browser signed out, say, or the room couldn't trust the connection's sign-in,
   * and a new connection is checked afresh. The app asks at once whether it's still signed in, rather
   * than waiting for the new connection to be refused.
   */
  Reconnect: 4001,
  /** Don't connect again: the person was removed from the workspace or banned, which ended all their sessions. */
  Revoked: 4003,
  /**
   * Don't connect again: the room isn't there for this person, who was taken out of it, or it was
   * deleted. The Worker says so with a socket it closes at once, since a refused upgrade looks to the
   * app like any network failure.
   */
  NotFound: 4004,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/** The shortest password first run takes, in characters rather than bytes, as ember-rust counts them. */
export const MIN_PASSWORD_LENGTH = 8;
/** The password fields' `maxlength`, which ember-rust's forms keep from bcrypt's 72-byte limit. */
export const MAX_PASSWORD_LENGTH = 72;
export const PASSWORD_TOO_SHORT = "Password must be at least 8 characters.";
export const PASSWORD_TOO_LONG = "Password must be at most 72 characters.";
/** Why a change to your email address or password is refused without your current password. */
export const CURRENT_PASSWORD_NEEDED = "Enter your current password to change your email address or password.";
/** Why it's refused with a current password that isn't yours. */
export const CURRENT_PASSWORD_WRONG = "That isn't your current password.";

export interface Boost {
  id: string;
  messageId: string;
  booster: User;
  content: string;
  createdAt: string;
}

export interface Message {
  id: string;
  /** Generated by the sender so its optimistic copy can be reconciled with the stored one. */
  clientMessageId: string;
  roomId: RoomId;
  creator: User;
  /**
   * Its text as rich text: the markup the room keeps of what the sender wrote (`prepareBody` in
   * packages/richtext). Clients show it through `displayBody`, never as markup.
   */
  body: string;
  /** Its plain text, as Action Text writes it, read from `body` when it was written. */
  plainText: string;
  /**
   * The people it mentions, once each, in order, named as they were when its text was last written. A
   * mention shows someone by the name they have now, which the people directory knows.
   */
  mentions: User[];
  createdAt: string;
  updatedAt: string;
  /** When its text last changed, or a bot changed its file, or null if neither has. */
  editedAt: string | null;
  boosts: Boost[];
  /**
   * A file message's file, which it shows in place of its text, as ember-rust's message shows its one
   * attachment. Its text is empty, and its plain text the file's name.
   */
  attachment?: StoredFile;
  /**
   * A bot's cards, which show under its text, as a Slack incoming webhook's blocks and attachments do: its
   * text may be empty then, and its plain text has theirs after its own.
   */
  cards?: Card[];
}

/**
 * What a tab sends on a room socket. A socket from an IP address a ban blocks can read, but the room
 * answers each frame that would change messages or boosts with an `error`, as ember-rust answers such
 * requests with 429.
 */
export type ClientFrame =
  /** A new message, its body markup, as the composer writes it. The room keeps what it can show of it, or refuses it. */
  | { type: "message.create"; clientMessageId: string; body: string }
  /** A message's new body, as for `message.create`. */
  | { type: "message.update"; messageId: string; body: string }
  | { type: "message.delete"; messageId: string }
  | { type: "boost.create"; messageId: string; content: string }
  | { type: "boost.delete"; boostId: string }
  | { type: "typing.start" }
  | { type: "typing.stop" }
  /** Up to `limit` messages before a message, oldest first, as history pages back from the oldest the timeline holds. */
  | { type: "history.before"; before: string; limit?: number }
  /** Up to `limit` messages after a message, as history pages forward from the newest the timeline holds while it's behind. */
  | { type: "history.after"; after: string; limit?: number }
  /**
   * The page around a message, as its permalink opens the room: up to a page before it, it, and up to a
   * page after. Without one, or for one the room doesn't have, the newest page, as Jump to newest message shows.
   */
  | { type: "history.around"; messageId?: string }
  /** Asks which of these messages the room stored from the sender, after a closed socket lost their confirmations. */
  | { type: "message.check"; clientMessageIds: string[] }
  /** Says the tab has been shown, or hidden, for a few seconds, since the socket's address or the last of these said otherwise. */
  | { type: "presence.visible"; visible: boolean }
  | { type: "ping" };

/**
 * A page of a room's messages that takes the timeline's place: the newest, or the one around a message
 * (ember-rust's `last_page` and `page_around`).
 */
export interface TimelinePage {
  /** Oldest first. */
  messages: Message[];
  /** Whether the room has messages older than the page. */
  hasMore: boolean;
  /** Whether it has newer ones, which only a page around a message can leave out. */
  hasNewer: boolean;
  /** The message the page is around, or null for the newest page. */
  around: string | null;
}

/**
 * What a room sends on a socket. The room numbers the changes to its messages, 1 for its first and one
 * more for each after: the frame that announces a change carries its number as `seq`, and a welcome or
 * `resumed` the latest. A tab that connects again names the latest it has seen (`since` in
 * `RoomSocketParams`), so the room can send only what changed after it.
 */
export type ServerFrame =
  /**
   * Everything a newcomer needs, including who's here. After it, they only hear who arrives and leaves. Its
   * page is the newest, or the one around the message the socket's address names, if the room has it.
   */
  | ({ type: "welcome"; you: User; present: User[]; seq: number } & TimelinePage)
  /**
   * Sent in place of a welcome to a tab that names the latest change it has seen, if the room still
   * keeps every change since: the messages changed after it, as they are now, oldest first, the ids of
   * those deleted, and who's here. A message both made and deleted since is among the deleted alone.
   */
  | { type: "resumed"; you: User; messages: Message[]; deletedIds: string[]; present: User[]; seq: number }
  /** A new message. Its author has stopped typing, too. */
  | { type: "message.created"; message: Message; seq: number }
  | { type: "message.updated"; message: Message; seq: number }
  | { type: "message.deleted"; messageId: string; seq: number }
  | { type: "boost.created"; boost: Boost; seq: number }
  | { type: "boost.deleted"; boostId: string; messageId: string; seq: number }
  /** Someone opened the room who didn't have it open already, in another tab. */
  | { type: "presence.joined"; user: User }
  /** Someone closed the last tab they had the room open in, which stops their typing, too. */
  | { type: "presence.left"; userId: UserId }
  | { type: "typing"; user: User; typing: boolean }
  /** Answers history.before: the page before `before`, oldest first, and whether there are older ones still. */
  | { type: "history"; before: string; messages: Message[]; hasMore: boolean }
  /** Answers history.after: the page after `after`, oldest first, and whether there are newer ones still. */
  | { type: "history.after"; after: string; messages: Message[]; hasNewer: boolean }
  /** Answers history.around with a page to show in the timeline's place. */
  | ({ type: "history.around" } & TimelinePage)
  /** Answers message.check: which of the sender's messages the room stored, and which it never received. */
  | { type: "message.checked"; stored: string[]; missing: string[] }
  /**
   * `failed` names the request that went wrong, when the error answers one, and `clientMessageId` or
   * `clientMessageIds` the messages it was about.
   */
  | { type: "error"; message: string; clientMessageId?: string; clientMessageIds?: string[]; failed?: ClientFrame["type"] }
  | { type: "pong" };

/**
 * What a tab sends on its workspace socket (`/api/socket`): only pings, which the runtime answers
 * without waking the Workspace.
 */
export type WorkspaceClientFrame = { type: "ping" };

/** What the Workspace sends on a tab's workspace socket. */
export type WorkspaceServerFrame =
  /** Sent as the Workspace lets the socket in: who its session signs in, and the workspace as it is then. */
  | { type: "welcome"; you: Me; account: Account }
  /** A room of theirs has a message they haven't seen, which marks it unread. Sent only to the person marked, as their mark changes. */
  | { type: "room.unread"; roomId: RoomId }
  /** They've read a room marked unread, in this tab or another. */
  | { type: "room.read"; roomId: RoomId }
  /**
   * Someone changed, as the people directory now lists them: they changed their profile, or an
   * administrator gave them another role, removed them, banned them or lifted their ban. Sent to everyone.
   */
  | { type: "user.updated"; user: DirectoryUser }
  /**
   * A room of theirs as it is now, sent to everyone in it when it's made, renamed, given another icon,
   * opened to everyone or made private, and to whoever a change puts in it, and to everyone in a DM
   * when it's started. A room they have keeps its mark, and one new to them starts read.
   */
  | { type: "room.saved"; room: Room }
  /** A room that's no longer theirs: deleted, or they've been taken out of it. Nobody else hears of it. */
  | { type: "room.gone"; roomId: RoomId }
  /**
   * A message came in a DM of theirs at `at`, which lists it first among their DMs, unless they've heard
   * of a later one. Sent to everyone in the DM, its author included, as the Workspace applies the message.
   */
  | { type: "room.active"; roomId: RoomId; at: string }
  /** They've starred or unstarred a room, in this tab or another: their stars as they are now. */
  | { type: "favorites.changed"; favorites: Favorites }
  /** They've given a room of theirs another notification level, in this tab or another. */
  | { type: "room.involvement"; roomId: RoomId; involvement: Involvement }
  /** They've dismissed the welcome card, in this tab or another, so their sidebar has no invitation from now on. */
  | { type: "invitation.dismissed" }
  /**
   * An administrator saved the shared room order, so the sidebar loads again, as ember-rust's
   * `room_order_changed` has every sidebar reload (broadcasts.rs). It names no rooms, since some aren't
   * everyone's. Sent to everyone, and to the people a room the order ranks takes in, whose sidebars'
   * order left it out.
   */
  | { type: "rooms.reordered" }
  /** An administrator changed the workspace's name, settings or custom CSS, which every page applies at once. Sent to everyone. */
  | { type: "account.updated"; account: Account }
  | { type: "error"; message: string }
  | { type: "pong" };

/**
 * The revision of the room protocol the app speaks, which its room sockets' addresses name. The room
 * tells a tab running an older app to reload, and refuses its messages and edits: before revision 2,
 * tabs sent a message's text rather than its markup, which the room would now read as markup, and
 * before revision 3, an edit dropped the message's mentions.
 */
export const ROOM_PROTOCOL = 3;

/** What a room socket's address tells the room about the tab opening it. */
export interface RoomSocketParams {
  /** Whether the tab is shown, which `presence.visible` frames update. */
  visible: boolean;
  /**
   * The latest change to the room the tab has seen, by its `seq`, when it has the room's messages from
   * an earlier socket: the room answers with what changed since (`resumed`) rather than a welcome, if it can.
   */
  since?: number;
  /**
   * The message whose permalink the tab opened the room at, which its welcome brings the page around, if the
   * room has it. Named only until the first welcome, since a socket that connects again keeps the tab's page.
   */
  around?: string;
}

/** The query that carries `params` on a room socket's address, with the revision of the protocol the tab speaks. */
export const roomSocketQuery = ({ visible, since, around }: RoomSocketParams) =>
  `?visible=${visible ? 1 : 0}&protocol=${ROOM_PROTOCOL}` +
  (since === undefined ? "" : `&since=${since}`) +
  (around === undefined ? "" : `&around=${encodeURIComponent(around)}`);

/** The part of a `URLSearchParams` that reading a socket's address needs, which the protocol, made for every runtime, names itself. */
interface SearchParams {
  get(name: string): string | null;
}

/** A change's number as an address writes it, or undefined for anything else. */
const parseSeq = (value: string | null) => (value !== null && /^\d{1,15}$/.test(value) ? Number(value) : undefined);

/** A message's id as an address names it, or undefined for none, or for what no message's id could be. */
const messageIdOf = (value: string | null) => (value !== null && id(value) ? value : undefined);

/**
 * What a room socket's address says about its tab, as `roomSocketQuery` wrote it, and the revision of the
 * protocol it speaks. A tab that doesn't say counts as shown and new to the room, and one naming no
 * revision speaks the first, as the app did before it named them.
 */
export const parseRoomSocketParams = (query: SearchParams): RoomSocketParams & { protocol: number } => ({
  visible: query.get("visible") !== "0",
  since: parseSeq(query.get("since")),
  around: messageIdOf(query.get("around")),
  protocol: Number(query.get("protocol")) || 1,
});

/** The most characters a message's plain text can have. */
export const MAX_MESSAGE_LENGTH = 10_000;
/** What the room says of a message with more, which the app says itself rather than send one. */
export const MESSAGE_TOO_LONG = `Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`;
/** Whether a message whose plain text is `plainText` is longer than the room takes. */
export const isMessageTooLong = (plainText: string) => plainText.length > MAX_MESSAGE_LENGTH;
/** The most characters of markup a message can arrive as: room for the longest message, formatted. */
export const MAX_MESSAGE_HTML_LENGTH = 100_000;
/** Matches the `boosts.content varchar(16)` column in ember-rust. */
export const MAX_BOOST_LENGTH = 16;
/**
 * ember-rust's page of messages (`Message::PAGE_SIZE`): the newest a room opens on, what each page of
 * history adds before or after the timeline, and how many a permalink shows on either side of its message.
 */
export const HISTORY_PAGE_SIZE = 40;
/** How many messages one message.check can ask about: more than anyone sends before a dead socket is noticed. */
export const MAX_CHECKED_MESSAGES = 50;
/** ember-rust has no limit; this keeps a name to what a sidebar row and a room's header can show. */
export const MAX_ROOM_NAME_LENGTH = 100;
/** ember-rust has no limit; this keeps the workspace's name to what the sidebar's heading can show. */
export const MAX_ACCOUNT_NAME_LENGTH = 100;
/** The longest host name DNS has, which a custom domain can be, with a port. */
const MAX_HOST_NAME_LENGTH = 253;
/**
 * ember-rust has no limit; this keeps custom CSS, which every page load and workspace socket carries,
 * well within what a row or a socket's message can hold.
 */
export const MAX_CUSTOM_STYLES_LENGTH = 100_000;
/** How many people one request can name: a bound on the request's size, not on a room's. */
export const MAX_LISTED_USERS = 1_000;
/** How many rooms someone can star, as ember-rust caps their list (`MAX_CHANNEL_ORDER`, account.rs). */
export const MAX_FAVORITES = 4_096;
/** How many rooms the shared order can rank, as ember-rust caps it (`MAX_CHANNEL_ORDER`, account.rs). */
export const MAX_SHARED_ORDER = 4_096;
/** The profile's Bio field's `maxlength` (users/profiles/show.html), which the server keeps too. */
export const MAX_BIO_LENGTH = 200;
/**
 * ember-rust has no limit on a person's or a bot's name; this keeps one to what a byline, a mention
 * and a directory row can show. Every message copies its author's name, so a name of megabytes would
 * swell a room's storage and every page of its history for everyone in it.
 */
export const MAX_USER_NAME_LENGTH = 100;
/** ember-rust has no limit; no deliverable address is longer (RFC 5321's path limit). */
export const MAX_EMAIL_ADDRESS_LENGTH = 254;
export const NAME_TOO_LONG = `Name must be at most ${MAX_USER_NAME_LENGTH} characters`;
export const EMAIL_ADDRESS_TOO_LONG = `Email address must be at most ${MAX_EMAIL_ADDRESS_LENGTH} characters`;

/** ember-rust's `REACTIONS`: the first three are quick reactions, the rest sit in the tray. */
export const REACTIONS = [
  ["👍", "Thumbs up"],
  ["👏", "Clapping"],
  ["👋", "Waving hand"],
  ["💪", "Muscle"],
  ["❤️", "Red heart"],
  ["😂", "Face with tears of joy"],
  ["🎉", "Party popper"],
  ["🔥", "Fire"],
] as const;
export const QUICK_REACTION_COUNT = 3;

const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
/** How many messages a page asked for may hold: 1 to 100, or undefined for a page's usual size. */
const pageLimit = (v: unknown) => (typeof v === "number" ? Math.min(Math.max(1, Math.floor(v)), 100) : undefined);
/** Whether `v` lists people's ids, as many as one request can name. */
const userIds = (v: unknown): v is UserId[] => Array.isArray(v) && v.length <= MAX_LISTED_USERS && v.every(id);

/** Markup no longer than `MAX_MESSAGE_HTML_LENGTH`, or null. Whether it holds a message is the room's to read. */
const markup = (v: unknown): string | null => (typeof v === "string" && v.length <= MAX_MESSAGE_HTML_LENGTH ? v : null);

/** Trimmed, non-empty text no longer than `max`, or null. */
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

/** The JSON object `raw` holds, or null if it holds anything else. */
function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(raw);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parses an untrusted frame from a room's socket. Returns null for anything malformed. */
export function parseClientFrame(raw: string): ClientFrame | null {
  const f = parseObject(raw);
  if (!f) return null;

  switch (f.type) {
    case "message.create": {
      const body = markup(f.body);
      return id(f.clientMessageId) && body !== null ? { type: f.type, clientMessageId: f.clientMessageId, body } : null;
    }
    case "message.update": {
      const body = markup(f.body);
      return id(f.messageId) && body !== null ? { type: f.type, messageId: f.messageId, body } : null;
    }
    case "message.delete":
      return id(f.messageId) ? { type: f.type, messageId: f.messageId } : null;
    case "boost.create": {
      const content = text(f.content, MAX_BOOST_LENGTH);
      return id(f.messageId) && content ? { type: f.type, messageId: f.messageId, content } : null;
    }
    case "boost.delete":
      return id(f.boostId) ? { type: f.type, boostId: f.boostId } : null;
    case "history.before":
      return id(f.before) ? { type: f.type, before: f.before, limit: pageLimit(f.limit) } : null;
    case "history.after":
      return id(f.after) ? { type: f.type, after: f.after, limit: pageLimit(f.limit) } : null;
    case "history.around":
      return f.messageId === undefined || id(f.messageId) ? { type: f.type, messageId: f.messageId } : null;
    case "message.check": {
      const ids = f.clientMessageIds;
      return Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_CHECKED_MESSAGES && ids.every(id)
        ? { type: f.type, clientMessageIds: ids }
        : null;
    }
    case "presence.visible":
      return typeof f.visible === "boolean" ? { type: f.type, visible: f.visible } : null;
    case "typing.start":
    case "typing.stop":
    case "ping":
      return { type: f.type };
    default:
      return null;
  }
}

/** Parses an untrusted frame from a workspace socket. Returns null for anything malformed. */
export function parseWorkspaceClientFrame(raw: string): WorkspaceClientFrame | null {
  return parseObject(raw)?.type === "ping" ? { type: "ping" } : null;
}

/**
 * Whether `value` could name a room. A room's id also names its Durable Object: the Workspace's
 * sortable ids, or the old address of a room from before it kept a list (`LEGACY_ROOMS`).
 */
export function isRoomId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

// Built on first use, so a bundle that never checks an icon leaves the names out.
let roomIconNames: ReadonlySet<string> | undefined;

/**
 * Whether `value` is exactly the name of an icon in the catalog, as ember-rust checks a room's
 * icon: `"coffee"` is, but `" coffee "`, `"Coffee"` and `""`, which stands for the default `#`, aren't.
 */
export function isRoomIcon(value: unknown): value is RoomIconName {
  roomIconNames ??= new Set(ROOM_ICON_NAMES);
  return typeof value === "string" && roomIconNames.has(value);
}

const ICON_REFUSED = 'Icon must be one of the room icons, or "" for the default';

/**
 * A room's icon as ember-rust's `parse_room_icon` takes it (rooms.rs): undefined when it's left out,
 * which keeps the icon, or null when it's neither "" nor exactly an icon's name.
 */
function iconChoice(value: unknown): RoomIconChoice | null | undefined {
  if (value === undefined) return undefined;
  return value === "" || isRoomIcon(value) ? value : null;
}

/** Parses an untrusted request to create a room. Returns why it's refused instead of the room. */
export function parseNewRoom(data: unknown): NewRoom | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const r = data as Record<string, unknown>;
  if (r.kind !== "open" && r.kind !== "closed") return 'Kind must be "open" or "closed"';
  const name = text(r.name, MAX_ROOM_NAME_LENGTH);
  if (!name) return `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`;
  const icon = iconChoice(r.icon);
  if (icon === null) return ICON_REFUSED;
  if (r.kind === "open") return { kind: r.kind, name, icon };
  const memberIds = r.memberIds ?? [];
  return userIds(memberIds) ? { kind: r.kind, name, icon, memberIds } : `Members must be a list of at most ${MAX_LISTED_USERS} user ids`;
}

/**
 * Parses an untrusted change to a room. Returns why it's refused instead of the changes. Making a
 * room private needs its members listed, even if that's nobody, since everyone left out is taken out.
 */
export function parseRoomChanges(data: unknown): RoomChanges | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const r = data as Record<string, unknown>;
  const name = r.name === undefined ? undefined : text(r.name, MAX_ROOM_NAME_LENGTH);
  if (name === null) return `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`;
  const icon = iconChoice(r.icon);
  if (icon === null) return ICON_REFUSED;
  const changes = { name, icon };
  if (r.kind === undefined) return changes;
  if (r.kind === "open") return { ...changes, kind: r.kind };
  if (r.kind !== "closed") return 'Kind must be "open" or "closed"';
  return userIds(r.memberIds) ? { ...changes, kind: r.kind, memberIds: r.memberIds } : `Members must be a list of at most ${MAX_LISTED_USERS} user ids`;
}

/** Whether `data` is a JSON object: an array is an object too, but not one that can name a change. */
const isJsonObject = (data: unknown): data is Record<string, unknown> => typeof data === "object" && data !== null && !Array.isArray(data);

/**
 * Parses an untrusted request to start a DM. Returns why it's refused instead of the DM. Naming nobody,
 * or leaving `userIds` out, starts your DM with yourself, as ember-rust's does without `user_ids`.
 */
export function parseNewDirect(data: unknown): NewDirect | string {
  if (!isJsonObject(data)) return "Expected a JSON object";
  const named = data.userIds === undefined ? [] : data.userIds;
  return userIds(named) ? { userIds: named } : `People must be a list of at most ${MAX_LISTED_USERS} user ids`;
}

/** The settings `PATCH /api/account` changes, each with the name workspace settings give it. */
const SETTING_NAMES: Record<keyof AccountSettings, string> = {
  hideTranslationButtons: "Hide translation buttons",
  restrictRoomCreation: "Must be admin to create new rooms",
};

/**
 * Parses an untrusted order of at most `max` rooms, as ember-rust's `parse_order` reads one
 * (users/sidebars.rs). Returns why it's refused instead of the rooms.
 */
function parseRoomOrder(data: unknown, max: number): RoomId[] | string {
  const roomIds = typeof data === "object" && data !== null ? (data as Record<string, unknown>).roomIds : undefined;
  if (!Array.isArray(roomIds)) return "roomIds must be an array";
  if (roomIds.length > max) return "too many rooms";
  const ids = roomIds.filter((id): id is RoomId => typeof id === "string" && isRoomId(id));
  return ids.length === roomIds.length && new Set(ids).size === ids.length ? ids : "room IDs must be unique and valid";
}

/** Parses an untrusted order for someone's starred rooms. Returns why it's refused instead of the rooms. */
export const parseFavoriteOrder = (data: unknown) => parseRoomOrder(data, MAX_FAVORITES);

/** Parses an untrusted shared room order. Returns why it's refused instead of the rooms. */
export const parseSharedOrder = (data: unknown) => parseRoomOrder(data, MAX_SHARED_ORDER);

/** A host as `location.host` writes one: its name, lowercase labels between dots, and maybe a port. */
const HOST = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::[0-9]{1,5})?$/;

/**
 * Where a deploy or `wrangler dev` puts Ember, which can't be its custom domain: a workers.dev address,
 * and localhost itself or a loopback address, though a name under localhost can, as a custom domain
 * stands in for one there.
 */
const DEPLOYED_HOSTNAME = /(?:^|\.)workers\.dev$|^localhost$|^127(?:\.[0-9]{1,3}){3}$|^\[::1\]$/;

/** Whether `host` is written as a custom domain is: as `location.host` writes it, with a name DNS could have. */
export function isHost(host: string): boolean {
  const name = host.length <= MAX_HOST_NAME_LENGTH + ":65535".length ? HOST.exec(host)?.[1] : undefined;
  return name !== undefined && name.length <= MAX_HOST_NAME_LENGTH;
}

/** Whether the host name `hostname` could be Ember's custom domain: any but where a deploy or `wrangler dev` puts it. */
export const canBeCustomDomain = (hostname: string) => !DEPLOYED_HOSTNAME.test(hostname.toLowerCase());

/** Why a custom domain is refused when it isn't a host. */
export const CUSTOM_DOMAIN_NOT_A_HOST = "Custom domain must be a host name, such as chat.example.com";
/** Why a custom domain is refused when it's where a deploy or `wrangler dev` puts Ember. */
export const NOT_A_CUSTOM_DOMAIN = "A workers.dev or localhost address can't be a custom domain";

/** A custom domain as `PATCH /api/account` may send one, a host or null for none, or undefined when it's neither. */
const customDomainOf = (value: unknown): string | null | undefined => (value === null || (typeof value === "string" && isHost(value)) ? value : undefined);

/**
 * What a custom domain reaches, as checking it finds: this Ember; something else, which answers there
 * but isn't it; or nothing yet, as before Cloudflare has added the domain, or while its certificate is
 * on the way.
 */
export type CustomDomainReach = "ember" | "elsewhere" | "nothing";

/** What `POST /api/account/custom_domain_checks` answers: what the domain it was sent reaches. */
export interface CustomDomainCheck {
  reaches: CustomDomainReach;
}

/**
 * Parses an untrusted request to check a custom domain, `{ domain }`, whose host could be Ember's as
 * one `PATCH /api/account` takes could. Returns why it's refused instead of the domain.
 */
export function parseCustomDomainCheck(data: unknown): { domain: string } | string {
  const domain = isJsonObject(data) && typeof data.domain === "string" && isHost(data.domain) ? data.domain : null;
  if (domain === null) return CUSTOM_DOMAIN_NOT_A_HOST;
  return canBeCustomDomain(HOST.exec(domain)![1]!) ? { domain } : NOT_A_CUSTOM_DOMAIN;
}

/**
 * Parses an untrusted change to the workspace. Returns why it's refused instead of the changes. As in
 * ember-rust, the name is saved as typed, even blank. Each setting is true or false, and one it doesn't
 * know is refused, where ember-rust fails (account.rs, `assign`). A custom domain is a host or null,
 * which the Worker then checks is the address the request came to.
 */
export function parseAccountChanges(data: unknown): AccountChanges | string {
  if (!isJsonObject(data)) return "Expected a JSON object";
  const { name, settings, customDomain } = data;
  if (name !== undefined && (typeof name !== "string" || name.length > MAX_ACCOUNT_NAME_LENGTH)) return `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`;
  const domain = customDomainOf(customDomain);
  if (customDomain !== undefined && domain === undefined) return CUSTOM_DOMAIN_NOT_A_HOST;
  const changes: AccountChanges = { ...(name !== undefined && { name }), ...(domain !== undefined && { customDomain: domain }) };
  if (settings === undefined) return changes;
  if (!isJsonObject(settings)) return "Settings must be a JSON object";
  const changed: AccountSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!Object.hasOwn(SETTING_NAMES, key)) return `Unknown setting: ${key}`;
    const setting = key as keyof AccountSettings;
    if (typeof value !== "boolean") return `${SETTING_NAMES[setting]} must be true or false`;
    changed[setting] = value;
  }
  return { ...changes, settings: changed };
}

/** Parses untrusted custom CSS, which is saved as typed, as in ember-rust. Returns why it's refused instead. */
export function parseCustomStyles(data: unknown): Partial<CustomStyles> | string {
  if (!isJsonObject(data)) return "Expected a JSON object";
  const { customStyles } = data;
  if (customStyles === undefined) return {};
  return typeof customStyles === "string" && customStyles.length <= MAX_CUSTOM_STYLES_LENGTH
    ? { customStyles }
    : `Custom CSS must be at most ${MAX_CUSTOM_STYLES_LENGTH.toLocaleString("en-US")} characters`;
}

/**
 * Parses an untrusted role change as ember-rust reads `user[role]` (accounts/users.rs): exactly
 * "administrator" makes someone an administrator, and anything else a member, blank included. Null
 * without a role at all, which ember-rust answers 400, as it does a request without `user`.
 */
export function parseRoleChange(data: unknown): RoleChange | null {
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("role" in data)) return null;
  return { role: data.role === "administrator" ? "administrator" : "member" };
}

/** Whether `value` is exactly one of the notification levels, as ember-rust's `Involvement::from_name` reads one. */
export const isInvolvement = (value: unknown): value is Involvement => (INVOLVEMENTS as readonly unknown[]).includes(value);

/**
 * Parses an untrusted change to someone's notification level in a room: the level, or null for
 * anything else. ember-rust stores a blank level as none at all, which leaves the room out of the
 * sidebar but shows no level, and fails on anything else (rooms/involvements.rs).
 */
export function parseInvolvementChange(data: unknown): Involvement | null {
  if (typeof data !== "object" || data === null) return null;
  const { involvement } = data as Record<string, unknown>;
  return isInvolvement(involvement) ? involvement : null;
}

const PROFILE_FIELDS = {
  name: "Name",
  emailAddress: "Email address",
  password: "Password",
  bio: "Bio",
  currentPassword: "Current password",
  pushSubscriptionEndpoint: "Push subscription endpoint",
} as const satisfies Record<keyof ProfileChanges, string>;

/**
 * Parses an untrusted change to your profile. Returns why it's refused instead. As in ember-rust
 * (profiles.rs), each field is saved as typed, even a blank name. The server keeps the form's limits
 * too: a password sign-in can take, and a 200-character bio.
 */
export function parseProfileChanges(data: unknown): ProfileChanges | string {
  if (!isJsonObject(data)) return "Expected a JSON object";
  const changes: ProfileChanges = {};
  for (const [field, label] of Object.entries(PROFILE_FIELDS) as [keyof ProfileChanges, string][]) {
    const value = data[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return `${label} must be text`;
    changes[field] = value;
  }
  if (changes.name !== undefined && changes.name.length > MAX_USER_NAME_LENGTH) return NAME_TOO_LONG;
  if (changes.emailAddress !== undefined && changes.emailAddress.length > MAX_EMAIL_ADDRESS_LENGTH) return EMAIL_ADDRESS_TOO_LONG;
  if (changes.password !== undefined && isPasswordTooLong(changes.password)) return PASSWORD_TOO_LONG;
  if (changes.bio !== undefined && changes.bio.length > MAX_BIO_LENGTH) return `Bio must be at most ${MAX_BIO_LENGTH} characters`;
  if (changes.pushSubscriptionEndpoint !== undefined && changes.pushSubscriptionEndpoint.length > MAX_PUSH_ENDPOINT_LENGTH) {
    return `Endpoint can't be longer than ${MAX_PUSH_ENDPOINT_LENGTH} characters`;
  }
  return changes;
}

/**
 * Parses an untrusted first run or join. Returns why it's refused instead, when a field is missing or
 * the name or email address is longer than Ember keeps; the password's length is checked apart from
 * this, since each form has its own rules.
 */
export function parseSignUp(data: unknown): SignUp | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const f = data as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  // Like ember-rust, take the address as typed: the browser checks its shape and trims it.
  const emailAddress = typeof f.emailAddress === "string" ? f.emailAddress : "";
  if (!name || !emailAddress || typeof f.password !== "string") return "Name, email address and password are required";
  if (name.length > MAX_USER_NAME_LENGTH) return NAME_TOO_LONG;
  if (emailAddress.length > MAX_EMAIL_ADDRESS_LENGTH) return EMAIL_ADDRESS_TOO_LONG;
  return { name, emailAddress, password: f.password };
}

/**
 * Parses an untrusted password reset. Returns why it's refused instead, when a field is missing; the
 * password's length is checked apart from this, as for first run.
 */
export function parsePasswordReset(data: unknown): PasswordReset | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const { emailAddress, password } = data as Record<string, unknown>;
  // Taken as given, as sign-in takes it.
  if (typeof emailAddress !== "string" || !emailAddress || typeof password !== "string") return "Email address and password are required";
  return { emailAddress, password };
}

/** Whether a password is shorter than first run takes, counting an emoji as one character. */
export const isPasswordTooShort = (password: string) => [...password].length < MIN_PASSWORD_LENGTH;

/**
 * Whether a password is longer than the password fields take, counting UTF-16 units as their
 * `maxlength` does, so the server takes exactly the passwords the forms can send.
 */
export const isPasswordTooLong = (password: string) => password.length > MAX_PASSWORD_LENGTH;

/**
 * Parses a frame from the server: a room's, or the workspace socket's when `Frame` says so. The
 * server is trusted, so this only guards against garbage.
 */
export function parseServerFrame<Frame extends { type: string } = ServerFrame>(raw: string): Frame | null {
  const data = parseObject(raw);
  return typeof data?.type === "string" ? (data as Frame) : null;
}
