import { Suspense, useContext, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Message } from "@ember/protocol";
import { editableBody } from "@ember/richtext/dom";
import { Check, Remove, Trash } from "@/components/icons/campfire";
import { mentionedPerson, PeopleContext } from "@/hooks/use-directory";
import { mentionPromptSrc } from "@/lib/api";
import { pressedAlone, savesEdit } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { RichTextEditor, type RichTextEditorHandle } from "./editor";
import { avatarUrlOf } from "./user-avatar";

/**
 * Campfire's round icon buttons (buttons.css), as the edit form's are: 36px, or 44px on touch screens,
 * with the icon at 1.3em, darkening on hover as `.btn--reversed` and `.btn--negative` do.
 */
const ROUND_BUTTON = "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full touch:size-11 hover:not-active:brightness-70";

interface Props {
  message: Message;
  /** Saves the message as written, answering whether the change went: one that didn't stays to be tried again. */
  onSave: (body: string) => boolean;
  onDelete: () => void;
  /** Closes the editor, discarding what's written in it. */
  onClose: () => void;
  ref?: Ref<MessageEditorHandle>;
}

export interface MessageEditorHandle {
  /** Focuses the text, keeping what's written in it. */
  focus(): void;
}

/**
 * ember-rust's edit form (messages/edit.html, Campfire's composer.css and messages.css, zz-ember.css), in
 * the message's place: a card holding the text in Lexxy, with its formatting toolbar above the text on
 * wide screens with a mouse (rich-text-editor.css), and round Save changes and Delete message buttons
 * under it, beside a button that closes it. Ctrl or Cmd+Enter saves, Escape closes it, and Enter starts a
 * new paragraph. @ offers the room's people, as the composer's does. Like ember-rust's, it takes no files
 * and tells no one you're typing.
 */
export function MessageEditor({ message, onSave, onDelete, onClose, ref }: Props) {
  const editor = useRef<RichTextEditorHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const people = useContext(PeopleContext);
  // ember-rust's editable body: its mentions as the editor draws them, of the people as they are now. It drops a
  // mention of no one, and a message from before messages named the people they mention knows them only from the
  // directory, so for such a message the editor waits for the directory, which lists everyone once it's loaded.
  const knowsMentions = people.size > 0 || message.mentions.every((person) => person.name !== "");
  const editableNow = () =>
    editableBody(message.body, (userId) => {
      const person = mentionedPerson(people, message.mentions, userId);
      return person && { id: person.id, name: person.name, avatarUrl: avatarUrlOf(people, person) };
    });
  const [editable, setEditable] = useState(() => (knowsMentions ? editableNow() : null));
  if (editable === null && knowsMentions) setEditable(editableNow());

  useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus() }), []);

  // ember-rust's scroll-into-view controller: once it's shown, the editor scrolls to the middle of the timeline.
  useEffect(() => {
    const frame = requestAnimationFrame(() => container.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const loading = <div className="min-h-6" />;

  const save = () => {
    const written = editor.current;
    // Saving a message left blank or as it was only closes the editor. An edit that couldn't be sent
    // keeps it open, so what was written isn't lost. Lexxy writes mentions with their content, so a
    // message with them is sent as it was, which the room keeps as it is.
    if (written && !written.isBlank() && written.value() !== message.body && !onSave(written.value())) return;
    onClose();
  };

  return (
    // The card and the close button sit half a character apart, and the close button as far from the
    // message's edge, where ember-rust's empty delete form takes another gap.
    <div ref={container} className="col-start-2 flex min-w-0 gap-x-[0.5ch] py-1 pr-[0.5ch] text-sm">
      <div className="message-edit min-w-0 flex-1 rounded-[10px] border bg-surface p-3">
        {/* Not validated, as the composer isn't, so the toolbar's hidden Link field can't stop Save. */}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          onKeyDownCapture={(event) => {
            // Taken before the editor sees it, unless a list the editor has open, such as the people to
            // mention, would take it, as such a list closes as it takes it.
            if (!savesEdit(event.nativeEvent) || editor.current?.hasOpenPrompt()) return;
            event.preventDefault();
            event.stopPropagation();
            save();
          }}
          onKeyDown={(event) => {
            // Lexxy's menus and lists close on Escape themselves, and keep it from here.
            if (pressedAlone(event.nativeEvent, "Escape")) onClose();
          }}
        >
          <div className="rounded-[9px] border bg-background px-[0.8em] py-[0.5em] text-base transition-shadow duration-150 focus-within:ring-2 focus-within:ring-selected-dark">
            {/* The composer has loaded the editor by the time a message can be edited. */}
            <Suspense fallback={loading}>
              {editable === null ? (
                loading
              ) : (
                <RichTextEditor
                  ref={editor}
                  label="Edit message"
                  rows={1}
                  initialValue={editable}
                  mentionsFrom={mentionPromptSrc(message.roomId)}
                  autoFocus
                />
              )}
            </Suspense>
          </div>
          <div className="flex items-center justify-between pt-2">
            <button type="submit" className={cn(ROUND_BUTTON, "bg-foreground")}>
              <Check tone="reversed" className="size-[1.3em]" />
              <span className="sr-only">Save changes</span>
            </button>
            <button
              type="button"
              className={cn(ROUND_BUTTON, "bg-negative-button")}
              onClick={() => confirm("Are you sure you want to delete this message?") && onDelete()}
            >
              <Trash tone="white" className="size-[1.3em]" />
              <span className="sr-only">Delete message</span>
            </button>
          </div>
        </form>
      </div>
      {/* `.message__actions`, which centers its button against the card. */}
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 cursor-pointer place-items-center rounded-full text-[0.8rem] touch:size-11 [@media(hover:hover)_and_(pointer:fine)]:hover:not-active:bg-border"
        >
          <Remove className="size-[1.3em]" />
          <span className="sr-only">Close editor and discard changes</span>
        </button>
      </div>
    </div>
  );
}
