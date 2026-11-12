import type { Message } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MessageActions } from "@/components/workspace/message-item";
import { composerEdit, useMessageEditors } from "./use-message-editors";

const message = { id: "m1", body: "<p>Hello</p>" } as Message;

function actionsThat(sends: boolean): MessageActions {
  return { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(() => sends), remove: vi.fn() } as unknown as MessageActions;
}

describe("useMessageEditors", () => {
  it("opens a message's editor in the timeline", () => {
    const { result } = renderHook(() => useMessageEditors({ current: null }));
    act(() => result.current.editors.open("m1"));
    expect([...result.current.editing]).toEqual(["m1"]);
    expect(result.current.editedHere).toBeNull();
  });

  it("edits it in the composer instead, as a phone does, until it's done", () => {
    const { result } = renderHook(() => useMessageEditors({ current: null }, true));
    act(() => result.current.editors.open("m1"));
    expect(result.current.editing.size).toBe(0);
    expect(result.current.editedHere).toBe("m1");
    act(() => result.current.doneHere());
    expect(result.current.editedHere).toBeNull();
  });
});

describe("composerEdit", () => {
  it("is nothing until the message is there to edit and the room takes changes", () => {
    expect(composerEdit(null, [message], actionsThat(true), vi.fn())).toBeNull();
    expect(composerEdit("m2", [message], actionsThat(true), vi.fn())).toBeNull();
    expect(composerEdit("m1", [message], null, vi.fn())).toBeNull();
  });

  it("saves with the message's actions, done once the change has gone, and cancelling is done too", () => {
    const done = vi.fn();
    const sending = actionsThat(true);
    const edit = composerEdit("m1", [message], sending, done)!;
    expect(edit.message).toBe(message);
    expect(edit.onSave("<p>Hi</p>")).toBe(true);
    expect(sending.edit).toHaveBeenCalledWith("m1", "<p>Hi</p>");
    expect(done).toHaveBeenCalledOnce();

    const kept = vi.fn();
    expect(composerEdit("m1", [message], actionsThat(false), kept)!.onSave("<p>Hi</p>")).toBe(false);
    expect(kept).not.toHaveBeenCalled();
    composerEdit("m1", [message], actionsThat(false), kept)!.onCancel();
    expect(kept).toHaveBeenCalledOnce();
  });
});
