import { feature } from "@ember/parity";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "./lightbox";

const QR_CODE = "/qr_code/aHR0cDovL3gvP2E=";

/** Gives the browser `name`, as some browsers have it, until the test ends. */
function stubNavigator(name: "canShare" | "share", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
  stubbed.push(name);
}
const stubbed: string[] = [];

afterEach(() => {
  for (const name of stubbed.splice(0)) delete (navigator as unknown as Record<string, unknown>)[name];
  vi.unstubAllGlobals();
});

// Closed, it's hidden, so it has no accessible name to find it by.
const viewer = () => document.querySelector("dialog")!;

describe(feature("attachments.lightbox"), () => {
  it("shows the image with Close and Download, labelled for screen readers", () => {
    render(<Lightbox src={QR_CODE} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Image Viewer (Press escape to close)" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog.querySelector(`img[src="${QR_CODE}"]`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close image viewer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download file" })).toHaveAttribute("href", QR_CODE);
  });

  it("stays closed with nothing to show", () => {
    render(<Lightbox src={null} onClose={() => {}} />);
    expect(viewer()).not.toHaveAttribute("open");
    expect(viewer().querySelector("img:not([aria-hidden])")).toBeNull();
  });

  it("closes with Close, and clears once it's closed", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Lightbox src={QR_CODE} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close image viewer" }));
    expect(viewer()).not.toHaveAttribute("open");
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<Lightbox src={null} onClose={onClose} />);
    expect(viewer().querySelector(`img[src="${QR_CODE}"]`)).toBeNull();
  });

  it("offers Share only where the browser can share", () => {
    render(<Lightbox src={QR_CODE} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Share file" })).not.toBeInTheDocument();
  });

  it("shares the file, named Ember_ and something random, with an empty title and text", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Closed", "AbortError"));
    const fetch = vi.fn().mockResolvedValue({ blob: async () => new Blob(["<svg/>"], { type: "image/svg+xml; charset=utf-8" }) });
    stubNavigator("canShare", () => true);
    stubNavigator("share", share);
    vi.stubGlobal("fetch", fetch);
    render(<Lightbox src={QR_CODE} onClose={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Share file" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(QR_CODE);
    const [{ files, ...data }] = share.mock.calls[0] as [{ files: File[]; title: string; text: string }];
    expect(data).toEqual({ title: "", text: "" });
    expect(files).toHaveLength(1);
    // ember-rust's name would end ".svg+xml; charset=utf-8", the whole of the type after its "/".
    expect(files[0]!.name).toMatch(/^Ember_[a-z0-9]+\.svg$/);
    expect(files[0]!.type).toBe("image/svg+xml; charset=utf-8");
  });
});
