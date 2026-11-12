import { useCallback, useMemo, useState, type RefObject } from "react";
import type { Message } from "@ember/protocol";
import type { ComposerEdit, ComposerHandle } from "@/components/workspace/composer";
import type { MessageEditorHandle } from "@/components/workspace/message-editor";
import type { MessageActions, MessageEditors } from "@/components/workspace/message-item";
import { hasTouchKeyboard } from "@/lib/keyboard";

/**
 * The editors open on a timeline's messages, by message, and what opens and closes them and writes
 * replies in `composer`, the timeline's: a room's, or a thread's. With `inComposer`, as on a phone, a
 * message is edited in the composer instead, as Slack iOS edits one: `editedHere` is the one being edited
 * there, and `doneHere` goes back to what was written.
 */
export function useMessageEditors(composer: RefObject<ComposerHandle | null>, inComposer = false) {
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set());
  const [editedHere, setEditedHere] = useState<string | null>(null);
  const editors = useMemo<MessageEditors>(() => {
    const open = new Map<string, MessageEditorHandle>();
    // As an editor closes, focus goes back to the composer, except on touch screens, where it would
    // bring up the keyboard.
    const returnFocus = () => {
      if (!hasTouchKeyboard()) composer.current?.focus();
    };
    return {
      // Up Arrow returns to your newest message's editor if it's open.
      open: (messageId) => {
        if (inComposer) return setEditedHere(messageId);
        const editor = open.get(messageId);
        if (editor) editor.focus();
        else setEditing((ids) => (ids.has(messageId) ? ids : new Set(ids).add(messageId)));
      },
      close: (messageId) => {
        setEditing((ids) => new Set([...ids].filter((id) => id !== messageId)));
        returnFocus();
      },
      returnFocus,
      attach: (messageId, editor) => {
        if (editor) open.set(messageId, editor);
        else open.delete(messageId);
      },
      reply: (quote) => composer.current?.replace(quote),
    };
  }, [composer, inComposer]);
  const doneHere = useCallback(() => setEditedHere(null), []);
  return { editing, editors, editedHere: inComposer ? editedHere : null, doneHere };
}

/**
 * What a timeline's composer edits, as `useMessageEditors` says, once the message is in `messages` and
 * the room still takes changes: saving it with `actions` goes back to what was written, as cancelling does.
 */
export function composerEdit(editedHere: string | null, messages: readonly Message[], actions: MessageActions | null, doneHere: () => void): ComposerEdit | null {
  const message = editedHere === null ? undefined : messages.find((candidate) => candidate.id === editedHere);
  if (!message || !actions) return null;
  return {
    message,
    onSave: (body) => {
      const sent = actions.edit(message.id, body);
      if (sent) doneHere();
      return sent;
    },
    onCancel: doneHere,
  };
}
