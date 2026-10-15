import { feature } from "@ember/parity";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import crown from "@/components/icons/campfire/crown.svg";
import laptop from "@/components/icons/campfire/laptop.svg";
import mobilePhone from "@/components/icons/campfire/mobile-phone.svg";
import transfer from "@/components/icons/campfire/transfer.svg";
import { SignInLink } from "./sign-in-link";

const TRANSFER_ID = "u2.mgk3x2a9.Ab-_9z";
const LINK = `http://localhost:3000/session/transfers/${TRANSFER_ID}`;
/** The link as padded URL-safe base64. */
const QR_CODE = "/qr_code/aHR0cDovL2xvY2FsaG9zdDozMDAwL3Nlc3Npb24vdHJhbnNmZXJzL3UyLm1nazN4MmE5LkFiLV85eg==";
const YOURS = "Use this link to login automatically on another device";
const THEIRS = "Share to get them back into their account";

/** Gives the browser `name`, as some browsers have it, until the test ends. */
function stubNavigator(name: "clipboard" | "canShare" | "share", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
  stubbed.push(name);
}
const stubbed: string[] = [];

afterEach(() => {
  for (const name of stubbed.splice(0)) delete (navigator as unknown as Record<string, unknown>)[name];
});

const iconsOf = (element: Element) => [...element.querySelectorAll("img")].map((icon) => icon.getAttribute("src"));

describe(feature("auth.sign-in-link"), () => {
  it("shows your own link, read-only, named for screen readers only, under a laptop, a transfer and a phone", () => {
    render(<SignInLink transferId={TRANSFER_ID} mine />);
    const link = screen.getByRole("textbox", { name: YOURS });
    expect(link).toHaveValue(LINK);
    expect(link).toHaveAttribute("readonly");
    expect(screen.getByText(YOURS)).toHaveClass("sr-only");
    expect(iconsOf(screen.getByRole("group").querySelector("legend")!)).toEqual([laptop, transfer, mobilePhone]);
    expect(screen.queryByText(THEIRS)).toBeNull();
  });

  it("says, beside a crown, that someone else's gets them back into their account", () => {
    render(<SignInLink transferId={TRANSFER_ID} mine={false} />);
    expect(screen.getByRole("textbox", { name: THEIRS })).toHaveValue(LINK);
    const label = screen.getByText(THEIRS);
    expect(label).not.toHaveClass("sr-only");
    expect(iconsOf(label.parentElement!)).toEqual([crown]);
  });

  it("has the join link's buttons, named for the sign-in link, and shares it with ember-rust's warning", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator("canShare", () => true);
    stubNavigator("share", share);
    render(<SignInLink transferId={TRANSFER_ID} mine />);
    const qrCode = screen.getByRole("link", { name: "Show auto-login QR code" });
    expect(qrCode).toHaveAttribute("href", QR_CODE);
    const copy = screen.getByRole("button", { name: "Copy auto-login link" });
    expect([qrCode.nextElementSibling, copy.nextElementSibling]).toEqual([copy, screen.getByRole("button", { name: "Share auto-login link" })]);

    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator("clipboard", { writeText });
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(LINK);
    await userEvent.click(screen.getByRole("button", { name: "Share auto-login link" }));
    expect(share).toHaveBeenCalledWith({
      title: "Your sign-in link",
      text: "This is your own private sign-in URL, DO NOT SHARE IT. Use it to sign-in on another device or if you get locked out.",
      url: LINK,
    });
  });

  it("offers sharing only where the browser can share", () => {
    render(<SignInLink transferId={TRANSFER_ID} mine />);
    expect(screen.queryByRole("button", { name: "Share auto-login link" })).toBeNull();
  });
});
