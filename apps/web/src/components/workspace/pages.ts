// The pages few visits need, a huddle's preview and bar, and first run's question about huddles, which load
// together apart from the rest of the app (`rarePage` in workspace.tsx, `loadSetupHuddles` in setup-page.tsx).
export { SetupHuddles } from "../setup-huddles";
export { AgentSettingsPage, NewAgentPage } from "./agent-page";
export { AppSettingsPage, NewAppPage } from "./app-page";
export { BotSettingsPage, NewBotPage } from "./bot-settings-page";
export { BotsPage } from "./bots-page";
export { CustomStylesPage } from "./custom-styles-page";
export { DirectSettingsPage } from "./direct-settings-page";
export { EmberPage } from "./ember-settings";
export { HuddleBar } from "./huddle-bar";
export { HuddlePreview } from "./huddle-preview";
export { SavedPage, TodosPage } from "./kept-pages";
export { NewRoomPage } from "./new-room-page";
export { PersonPage } from "./person-page";
export { ProfilePage } from "./profile-page";
export { PushSubscriptionsPage } from "./push-subscriptions-page";
export { RoomSettingsPage } from "./room-settings-page";
export { SearchPage } from "./search-page";
export { WorkspaceSettingsPage } from "./workspace-settings-page";
export { DraftsPage } from "./drafts-page";
export { PeoplePage } from "./people-page";
export { ThreadsPage } from "./threads-page";
export { DirectsColumn, DirectsHome } from "./directs-pane";
export { FilesNav } from "./files-nav";
export { FilesPage } from "./files-page";
export { AddTabDialog, EditTabsDialog, RoomTabPanel } from "./room-tab-panels";
export { EmojiPicker } from "@/components/emoji-picker";
// Dialogs and panels few visits open, which load with the pages.
export { ActivityPage } from "./activity-page";
export { ForwardDialog } from "./forward-dialog";
export { FilesPicker } from "./files-picker";
export { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
export { MembersDialog } from "./members-dialog";
export { NewDirectDialog } from "./new-direct-dialog";
export { NotificationHelp } from "./notification-help";
export { ProfilePanel } from "./profile-panel";
export { SearchBox } from "./search-dialog";
export { TimeDialog } from "./time-dialog";
// The pages before a workspace but for signing in (signed-out-page.tsx).
export { EmailSignUpPage } from "../email-sign-up-page";
export { InvitationPage } from "../invitation-page";
export { JoinPage } from "../join-page";
export { PasswordResetPage } from "../password-reset-page";
export { SetupPage } from "../setup-page";
export { GuestSignIn } from "../guest-sign-in";
export { DeleteMessageDialog } from "./confirm-dialog";
export { InvitationCard } from "./invitation-card";
export { Lightbox } from "../lightbox";
