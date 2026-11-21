import { roomTranscriptPath, workspaceTranscriptPath } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlashProvider } from "@/components/flash";
import { TranscriptDownload } from "./transcript-download";

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

describe("Transcript download", () => {
  it("links a room's Markdown and JSON transcripts, hidden where Ember on a home screen can't download", () => {
    render(<TranscriptDownload roomId="design" heading="Transcript" description="Download this room's messages as Markdown or JSON." />);
    expect(screen.getByRole("heading", { level: 2, name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByText("Download this room's messages as Markdown or JSON.")).toBeInTheDocument();
    const markdown = screen.getByRole("link", { name: "Markdown" });
    const json = screen.getByRole("link", { name: "JSON" });
    expect(markdown).toHaveAttribute("href", roomTranscriptPath("design"));
    expect(markdown).toHaveAttribute("download");
    expect(markdown).toHaveClass("ios-pwa:hidden");
    expect(json).toHaveAttribute("href", roomTranscriptPath("design", "json"));
    expect(json).toHaveAttribute("download");
    expect(json).toHaveClass("ios-pwa:hidden");
    expect(markdown.querySelector("svg")).toHaveClass("iconoir-download");
    // No Share where the browser can't share.
    expect(screen.queryByRole("button", { name: /^Share/ })).not.toBeInTheDocument();
  });

  it("links every conversation when no room is named", () => {
    render(<TranscriptDownload heading="Transcript" description="Download every room and DM you're in." />);
    expect(screen.getByRole("link", { name: "Markdown" })).toHaveAttribute("href", workspaceTranscriptPath());
    expect(screen.getByRole("link", { name: "JSON" })).toHaveAttribute("href", workspaceTranscriptPath("json"));
  });

  it("shares each format's transcript, where the browser can share", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Closed", "AbortError"));
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["{}"], { type: "application/json; charset=utf-8" }) });
    stubNavigator("canShare", () => true);
    stubNavigator("share", share);
    vi.stubGlobal("fetch", fetch);
    render(
      <FlashProvider>
        <TranscriptDownload roomId="design" heading="Transcript" description="Download this room's messages as Markdown or JSON." />
      </FlashProvider>,
    );

    expect(screen.getByRole("button", { name: "Share Markdown" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Share JSON" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(roomTranscriptPath("design", "json"));
    const [{ files, title }] = share.mock.calls[0] as [{ files: File[]; title: string }];
    expect(title).toBe("Transcript");
    expect(files[0]!.name).toMatch(/^Ember_[a-z0-9]+\.json$/);
  });
});
