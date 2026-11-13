import { roomTranscriptPath, workspaceTranscriptPath } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranscriptDownload } from "./transcript-download";

describe("Transcript download", () => {
  it("links a room's Markdown and JSON transcripts", () => {
    render(<TranscriptDownload roomId="design" heading="Transcript" description="Download this room's messages as Markdown or JSON." />);
    expect(screen.getByRole("heading", { level: 2, name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByText("Download this room's messages as Markdown or JSON.")).toBeInTheDocument();
    const markdown = screen.getByRole("link", { name: "Markdown" });
    const json = screen.getByRole("link", { name: "JSON" });
    expect(markdown).toHaveAttribute("href", roomTranscriptPath("design"));
    expect(markdown).toHaveAttribute("download");
    expect(json).toHaveAttribute("href", roomTranscriptPath("design", "json"));
    expect(json).toHaveAttribute("download");
    expect(markdown.querySelector("svg")).toHaveClass("iconoir-download");
  });

  it("links every conversation when no room is named", () => {
    render(<TranscriptDownload heading="Transcript" description="Download every room and DM you're in." />);
    expect(screen.getByRole("link", { name: "Markdown" })).toHaveAttribute("href", workspaceTranscriptPath());
    expect(screen.getByRole("link", { name: "JSON" })).toHaveAttribute("href", workspaceTranscriptPath("json"));
  });
});
