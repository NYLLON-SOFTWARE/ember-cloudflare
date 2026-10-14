import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitationCard } from "./invitation-card";

const JOIN_CODE = "aB3d-Ef5h-iJ7k";
const LINK = `http://localhost:3000/join/${JOIN_CODE}`;
/** The link as padded URL-safe base64. */
const QR_CODE = "/qr_code/aHR0cDovL2xvY2FsaG9zdDozMDAwL2pvaW4vYUIzZC1FZjVoLWlKN2s=";

/** Gives the browser `name`, as some browsers have it, until the test ends. */
function stubNavigator(name: "clipboard" | "canShare" | "share", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
  stubbed.push(name);
}
const stubbed: string[] = [];

afterEach(() => {
  for (const name of stubbed.splice(0)) delete (navigator as unknown as Record<string, unknown>)[name];
});

describe(feature("rooms.invitation-card"), () => {
  it("welcomes people with the workspace's join link, labelled for screen readers", () => {
    render(<InvitationCard joinCode={JOIN_CODE} />);
    expect(screen.getByRole("img", { name: "Ember" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Welcome to Ember" })).toBeInTheDocument();
    expect(screen.getByText("To invite people to chat, share the join link below.")).toBeInTheDocument();
    const link = screen.getByRole("textbox", { name: "Share to invite more people" });
    expect(link).toHaveValue(LINK);
    expect(link).toHaveAttribute("readonly");
  });
});

describe(feature("accounts.join-link"), () => {
  it("copies the link, and plays its success each time", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator("clipboard", { writeText });
    render(<InvitationCard joinCode={JOIN_CODE} />);
    const copy = screen.getByRole("button", { name: "Copy join link" });

    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(LINK);
    await waitFor(() => expect(copy).toHaveClass("motion-safe:animate-success"));

    // The class comes off while the link is copied again, which starts the animation over.
    let finishCopying!: () => void;
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => (finishCopying = resolve)));
    await userEvent.click(copy);
    expect(copy).not.toHaveClass("motion-safe:animate-success");
    finishCopying();
    await waitFor(() => expect(copy).toHaveClass("motion-safe:animate-success"));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("leaves the button alone when the clipboard refuses", async () => {
    stubNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) });
    render(<InvitationCard joinCode={JOIN_CODE} />);
    const copy = screen.getByRole("button", { name: "Copy join link" });
    await userEvent.click(copy);
    expect(copy).not.toHaveClass("motion-safe:animate-success");
  });

  it("offers sharing only where the browser can share", async () => {
    render(<InvitationCard joinCode={JOIN_CODE} />);
    expect(screen.queryByRole("button", { name: "Share join link" })).not.toBeInTheDocument();
  });

  it("shares ember-rust's invitation with the link", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Closed", "AbortError"));
    stubNavigator("canShare", () => true);
    stubNavigator("share", share);
    render(<InvitationCard joinCode={JOIN_CODE} />);
    await userEvent.click(screen.getByRole("button", { name: "Share join link" }));
    expect(share).toHaveBeenCalledWith({ title: "Link to join Ember", text: "Hit this link to join me in Ember and start chatting.", url: LINK });
  });
});

describe(feature("accounts.qr-codes"), () => {
  it("opens the join link's QR code in the image viewer", async () => {
    render(<InvitationCard joinCode={JOIN_CODE} />);
    const link = screen.getByRole("link", { name: "Show join link QR code" });
    expect(link).toHaveAttribute("href", QR_CODE);

    await userEvent.click(link);
    const viewer = screen.getByRole("dialog", { name: "Image Viewer (Press escape to close)" });
    expect(viewer).toHaveAttribute("open");
    expect(viewer.querySelector(`img[src="${QR_CODE}"]`)).toBeInTheDocument();
    expect(within(viewer).getByRole("link", { name: "Download file" })).toHaveAttribute("download", "QR code.svg");
  });

  it("puts it before Copy and Share, as ember-rust does", () => {
    render(<InvitationCard joinCode={JOIN_CODE} />);
    const show = screen.getByRole("link", { name: "Show join link QR code" });
    expect(show.previousElementSibling).toBeNull();
    expect(show.nextElementSibling).toBe(screen.getByRole("button", { name: "Copy join link" }));
  });
});
