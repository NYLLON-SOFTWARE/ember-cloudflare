import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShareWarning, shareWarningLine, shareWarningTitle } from "./share-warning";

describe("Share warning", () => {
  it("names the room or the DM it's from, and who in the room it's to can't see the original", () => {
    expect(shareWarningTitle({ label: "#design", direct: false })).toBe("Share outside #design?");
    expect(shareWarningTitle({ label: "Grace", direct: true })).toBe("Share outside your DM with Grace?");
    expect(shareWarningLine(1, { label: "#launch", direct: false })).toBe("1 person in #launch can't see the original.");
    expect(shareWarningLine(3, { label: "Grace and Linus", direct: true })).toBe("3 people in your DM with Grace and Linus can't see the original.");
  });

  it("asks with Cancel, which has focus, and Share, and nothing else", async () => {
    const [onShare, onCancel] = [vi.fn(), vi.fn()];
    render(<ShareWarning source={{ label: "Grace", direct: true }} target={{ label: "#launch", direct: false }} newViewers={2} onShare={onShare} onCancel={onCancel} />);
    const warning = screen.getByRole("alertdialog", { name: "Share outside your DM with Grace?" });
    expect(warning).toHaveTextContent(/^Share outside your DM with Grace\?2 people in #launch can't see the original\.CancelShare$/);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
