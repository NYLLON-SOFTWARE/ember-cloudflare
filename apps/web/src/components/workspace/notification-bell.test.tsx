import { feature } from "@ember/parity";
import type { Room } from "@ember/protocol";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushProvider } from "@/hooks/use-push";
import { isPushOn, savePushAgain, subscribeToPushEnding, turnOnPush, type PushNotice } from "@/lib/push";
import { CHROME_MAC } from "@/test-platforms";
import { NotificationBell } from "./notification-bell";

vi.mock("@/lib/push", () => ({
  isPushOn: vi.fn(async () => false),
  savePushAgain: vi.fn(async () => {}),
  turnOnPush: vi.fn(async () => null),
  subscribeToPushEnding: vi.fn(() => () => {}),
}));

const KEY = "BP79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eDf3t3c29rZ2NfW1dTT0tHQz87NzMvKycjHxsXEw8LBwL8";
const general: Room = { id: "general", name: "general", kind: "open", icon: null };

const BLOCKED: PushNotice = { title: "Notifications are blocked", message: "Allow notifications for this site in your browser settings, then try again.", help: true };
const UNCONFIGURED: PushNotice = { title: "Notifications aren’t configured", message: "Ask your workspace administrator to configure Web Push on this server.", help: false };

/** The bell in general's header, on Chrome on a Mac. */
function renderBell() {
  render(
    <PushProvider vapidPublicKey={KEY} platform={CHROME_MAC}>
      <NotificationBell room={general} involvement="mentions" askForRoom={() => vi.fn()} onFailed={vi.fn()} />
    </PushProvider>,
  );
  return userEvent.setup();
}

const enableButton = () => screen.getByRole("button", { name: "Enable notifications" });
const levelBell = () => screen.queryByRole("checkbox", { name: "Notifying about @ mentions" });
const setup = () => screen.queryByRole("dialog", { name: "Notification setup" });

/** Settles turning notifications on when called, as `turnOnPush` would with `notice`. */
function turningOn() {
  let settle!: (notice: PushNotice | null) => void;
  vi.mocked(turnOnPush).mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
  return (notice: PushNotice | null) => act(() => settle(notice));
}

afterEach(() => vi.clearAllMocks());

describe(feature("notifications.enable"), () => {
  it("offers to turn notifications on until this browser has them on, saving nothing", async () => {
    renderBell();
    expect(enableButton()).toHaveAttribute("title", "Enable notifications");
    expect(levelBell()).not.toBeInTheDocument();
    expect(isPushOn).toHaveBeenCalledWith(KEY);
    await act(async () => {});
    expect(savePushAgain).not.toHaveBeenCalled();
  });

  it("is your level's bell once they're on, without asking the server", async () => {
    vi.mocked(isPushOn).mockResolvedValueOnce(true);
    renderBell();
    expect(await screen.findByRole("checkbox", { name: "Notifying about @ mentions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable notifications" })).not.toBeInTheDocument();
    expect(turnOnPush).not.toHaveBeenCalled();
  });

  it("saves this browser's subscription again once it finds them on, so the server keeps it among your most recent", async () => {
    vi.mocked(isPushOn).mockResolvedValueOnce(true);
    renderBell();
    await screen.findByRole("checkbox", { name: "Notifying about @ mentions" });
    expect(savePushAgain).toHaveBeenCalledOnce();
  });

  it("offers to turn them on again once logging out has ended the subscription, should signing out then fail", async () => {
    vi.mocked(isPushOn).mockResolvedValueOnce(true);
    renderBell();
    expect(await screen.findByRole("checkbox", { name: "Notifying about @ mentions" })).toBeInTheDocument();
    const ended = vi.mocked(subscribeToPushEnding).mock.calls[0]![0];
    act(() => ended());
    expect(enableButton()).toBeInTheDocument();
    expect(levelBell()).not.toBeInTheDocument();
  });

  it("turns them on with a press, ignoring more while it's busy, then hands focus to your level's bell", async () => {
    const user = renderBell();
    const settle = turningOn();
    await user.click(enableButton());
    expect(turnOnPush).toHaveBeenCalledWith(KEY);
    expect(enableButton()).toHaveAttribute("aria-busy", "true");
    expect(enableButton()).toHaveAttribute("aria-disabled", "true");
    // It keeps focus, where a disabled button would lose it.
    expect(enableButton()).toHaveFocus();
    await user.click(enableButton());
    expect(turnOnPush).toHaveBeenCalledOnce();

    await settle(null);
    expect(levelBell()).toHaveFocus();
    expect(setup()).not.toBeInTheDocument();
  });

  it("leaves focus be when the press didn't focus it, as Safari's clicks don't", async () => {
    renderBell();
    fireEvent.click(enableButton());
    expect(await screen.findByRole("checkbox", { name: "Notifying about @ mentions" })).not.toHaveFocus();
  });

  it("says why they aren't on in the Notification setup dialog, with help for this browser, and Close at hand", async () => {
    vi.mocked(turnOnPush).mockResolvedValueOnce(BLOCKED);
    const user = renderBell();
    await user.click(enableButton());

    const dialog = await screen.findByRole("dialog", { name: "Notification setup" });
    expect(screen.getByRole("heading", { name: "Notifications are blocked" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Allow notifications for this site in your browser settings, then try again.");
    expect(screen.getByText("Check your Chrome settings")).toBeVisible();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(enableButton()).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog).not.toHaveAttribute("open");
  });

  it("gives no help where it wouldn't help, and says so again for each press", async () => {
    vi.mocked(turnOnPush).mockResolvedValue(UNCONFIGURED);
    const user = renderBell();
    await user.click(enableButton());
    expect(await screen.findByRole("heading", { name: "Notifications aren’t configured" })).toBeInTheDocument();
    expect(screen.getByText("Check your Chrome settings")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(enableButton());
    expect(await screen.findByRole("dialog", { name: "Notification setup" })).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });
});
