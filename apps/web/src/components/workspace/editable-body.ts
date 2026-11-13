import { useContext, useState } from "react";
import type { Message } from "@ember/protocol";
import { editableBody } from "@ember/richtext/dom";
import { DirectoryLoaded, mentionedPerson, PeopleContext } from "@/hooks/use-directory";
import { editedBody, forwardParts } from "@/lib/messages";
import { avatarUrlOf } from "./user-avatar";

/**
 * `message`'s body as an editor opens it to be changed, as the message editor does and the composer in
 * edit mode: its mentions as the editor draws them, of the people as they are now, and its link previews as
 * the message shows them here. It drops a mention of no one, and a message from before messages named the
 * people they mention knows them only from the directory, so for such a message it's null until the
 * directory loads, when it lists everyone. It's read once each time a message is edited, so what others change
 * while it's being edited doesn't replace what's written.
 */
export function useEditableBody(message: Message | null): string | null {
  const people = useContext(PeopleContext);
  const directoryLoaded = useContext(DirectoryLoaded);
  const [editable, setEditable] = useState<{ id: string; body: string } | null>(null);
  // Done with, it's read afresh next time, as the message may have changed since, as by this edit.
  if (!message && editable !== null) setEditable(null);
  if (message && editable?.id !== message.id && (directoryLoaded || message.mentions.every((person) => person.name !== ""))) {
    const body = editableBody(
      forwardParts(message.body)?.note ?? message.body,
      (userId) => {
        const person = mentionedPerson(people, message.mentions, userId);
        return person && { id: person.id, name: person.name, avatarUrl: avatarUrlOf(people, person) };
      },
      location.hostname,
    );
    setEditable({ id: message.id, body });
  }
  return message && editable?.id === message.id ? editable.body : null;
}

/** What the edit opened with: the message's body then, and the texts the editor showed it as. */
export interface EditOpened {
  body: string;
  written: string[];
}

/** Why Save asks again, the first time, where someone else saved the message while it was being edited. */
export const CHANGED_MEANWHILE = "This message was edited while you were editing it. Save again to replace that edit.";

/**
 * What saving an edit of `message`, as `written`, does: nothing where it's as the edit opened, so a Save that
 * changed nothing can't put back what someone else saved since; warns first where the message changed
 * meanwhile, someone else's edit or another tab's; and otherwise saves the body.
 */
export function editSave(message: Message, opened: EditOpened, written: string): { body: string } | "unchanged" | "changed meanwhile" {
  if (opened.written.includes(written) || editedBody(message, written) === opened.body) return "unchanged";
  if (message.body !== opened.body) return "changed meanwhile";
  return { body: editedBody(message, written) };
}
