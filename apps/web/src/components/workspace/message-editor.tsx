import { Suspense, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Message } from "@ember/protocol";
import { useScrollIntoView } from "@/hooks/use-scroll-into-view";
import { mentionPromptSrc } from "@/lib/api";
import { hasTouchKeyboard, pressedAlone } from "@/lib/keyboard";
import { editedBody } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { COMPOSER_CARD, TEXT_BUTTON } from "./composer-buttons";
import { useFormatting } from "./composer-formatting";
import { RichTextEditor, type RichTextEditorHandle } from "./editor";
import { useEditableBody } from "./editable-body";
import { ForwardQuote } from "./message-body";

interface Props {
  message: Message;
  /** Saves the message as written, answering whether the change went: one that didn't stays to be tried again. */
  onSave: (body: string) => boolean;
  /** Closes the editor, discarding what's written in it. */
  onClose: () => void;
  ref?: Ref<MessageEditorHandle>;
}

export interface MessageEditorHandle {
  /** Focuses the text, keeping what's written in it. */
  focus(): void;
}

/** Cancel and Save, as Slack's: 32px text buttons, or 44px on touch screens. */

/**
 * The edit form, in place of the message's text, under its author and time, as Slack's is: the composer's
 * card, with its toolbar over the text on wide screens with a mouse, and Cancel and Save under it. Its keys
 * are the composer's: Enter saves, as it would send, Shift+Enter starts a new line, as does Enter in a list
 * or a code block, and Escape cancels. @ offers the room's people, as the composer's does. It takes no files
 * and tells no one you're typing. Delete message is in the message's actions, not here.
 */
export function MessageEditor({ message, onSave, onClose, ref }: Props) {
  const editor = useRef<RichTextEditorHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const editable = useEditableBody(message);
  const { onFormats, keyDown, toolbar } = useFormatting(editor);
  // Phones' keyboards leave no room for it, as the composer hides it there until Aa shows it.
  const [toolbarShown] = useState(() => !hasTouchKeyboard());

  useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus() }), []);
  useScrollIntoView(container);

  const loading = <div className="min-h-6" />;

  const save = () => {
    const written = editor.current;
    // Saving a message left blank or as it was only closes the editor. An edit that couldn't be sent
    // keeps it open, so what was written isn't lost. Lexxy writes mentions with their content, so a
    // message with them is sent as it was, which the room keeps as it is.
    const body = written && !written.isBlank() ? editedBody(message, written.value()) : null;
    if (body !== null && body !== message.body && !onSave(body)) return;
    onClose();
  };

  return (
    <div
      ref={container}
      className="min-w-0 py-1"
      onKeyDown={(event) => {
        // Lexxy's menus and lists close on Escape themselves, and keep it from here, as the toolbar's
        // menus, in their own layer outside this, do for theirs.
        if (pressedAlone(event.nativeEvent, "Escape") && container.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div className={cn("composer", COMPOSER_CARD)} data-toolbar={toolbarShown || undefined}>
        {toolbarShown && toolbar}
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
              toolbar={false}
              onFormats={onFormats}
              onKeyDown={(event) => keyDown(event, save)}
            />
          )}
        </Suspense>
      </div>
      <ForwardQuote message={message} className="pt-2" />
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" title="Esc" onClick={onClose} className={cn(TEXT_BUTTON, "border bg-background hover:bg-hover")}>
          Cancel
        </button>
        <button type="button" title="Enter" onClick={save} className={cn(TEXT_BUTTON, "bg-foreground text-background hover:brightness-85")}>
          Save
        </button>
      </div>
    </div>
  );
}
