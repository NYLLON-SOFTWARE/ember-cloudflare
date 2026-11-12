import { useContext, useState } from "react";
import type { Message } from "@ember/protocol";
import { editableBody } from "@ember/richtext/dom";
import { DirectoryLoaded, mentionedPerson, PeopleContext } from "@/hooks/use-directory";
import { avatarUrlOf } from "./user-avatar";

/**
 * `message`'s body as an editor opens it to be changed, as the message editor does and the composer in
 * edit mode: its mentions as the editor draws them, of the people as they are now, and its link previews as
 * the message shows them here. It drops a mention of no one, and a message from before messages named the
 * people they mention knows them only from the directory, so for such a message it's null until the
 * directory loads, when it lists everyone. It's read once for each message, so what others change while
 * it's being edited doesn't replace what's written.
 */
export function useEditableBody(message: Message | null): string | null {
  const people = useContext(PeopleContext);
  const directoryLoaded = useContext(DirectoryLoaded);
  const [editable, setEditable] = useState<{ id: string; body: string } | null>(null);
  if (message && editable?.id !== message.id && (directoryLoaded || message.mentions.every((person) => person.name !== ""))) {
    const body = editableBody(
      message.body,
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
