import { useRef, useState } from "react";
import type { User } from "@ember/protocol";
import { MAX_MESSAGE_LENGTH } from "@ember/protocol";
import { ArrowUp } from "lucide-react";

function typingSentence(users: User[]): string {
  const names = users.map((u) => u.name);
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

interface Props {
  roomName: string;
  typing: User[];
  disabled: boolean;
  onSend: (body: string) => void;
  onTyping: (active: boolean) => void;
}

/** ember-rust's two-row composer card: the text on top, actions and a round send button below. */
export function Composer({ roomName, typing, disabled, onSend, onTyping }: Props) {
  const [body, setBody] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = body.trim();
    if (!text || disabled) return;
    onSend(text);
    setBody("");
    input.current?.focus();
  };

  return (
    <footer className="bg-background px-[22px] pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] max-md:px-2.5 max-md:pt-2 max-md:pb-[max(10px,env(safe-area-inset-bottom))]">
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p aria-live="polite" className="absolute -top-[19px] left-0 m-0 text-[11px] text-muted-foreground max-md:-top-[15px]">
          {typing.length > 0 && typingSentence(typing)}
        </p>
        <div className="flex min-h-[108px] flex-col rounded-xl border bg-surface p-3 focus-within:border-muted-foreground max-md:min-h-[100px] max-md:p-2.5">
          <label htmlFor="composer" className="sr-only">
            Message #{roomName}
          </label>
          <textarea
            id="composer"
            ref={input}
            rows={1}
            value={body}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={`Message #${roomName}`}
            onChange={(event) => {
              setBody(event.target.value);
              onTyping(event.target.value.length > 0);
            }}
            onBlur={() => onTyping(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="field-sizing-content max-h-[min(32dvh,300px)] min-h-10 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none max-md:min-h-[30px] max-md:text-base"
          />
          <div className="mt-1 flex items-center gap-0.5">
            <span className="text-xs text-muted-foreground max-md:hidden">Shift + Enter for a new line</span>
            <button
              type="submit"
              disabled={disabled || body.trim().length === 0}
              aria-label="Send"
              title="Send"
              className="ml-auto flex size-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40 max-md:size-11"
            >
              <ArrowUp className="size-[18px]" />
            </button>
          </div>
        </div>
      </form>
    </footer>
  );
}
