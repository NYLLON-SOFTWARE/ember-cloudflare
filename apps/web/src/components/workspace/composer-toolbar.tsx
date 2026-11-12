import { Fragment, useEffect, useEffectEvent, useId, useState, type KeyboardEvent } from "react";
import { NavArrowDown } from "@/components/icons/iconoir";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { appleKeyboard } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { TEXT_BUTTON, TOOL, TOOL_ICON } from "./composer-buttons";
import { BLOCKS, isActive, isDisabled, linkAddress, TOOL_GROUPS, type Block, type Format, type Formats, type Tool } from "./formatting";
import { PopoverMenu } from "./popover-menu";

/** Iconoir's icon for each button, painted from its file (rich-text-editor.css). */
function ToolIcon({ tool }: { tool: Tool }) {
  return <span aria-hidden="true" data-icon={tool} className={TOOL_ICON} />;
}

/** A tool's keys, as its tooltip shows them: Cmd's ⌘ on an Apple keyboard, Ctrl+ on another. */
const keysOf = (keys: string) => (appleKeyboard() ? `⌘${keys}` : `Ctrl+${keys.replace("⇧", "Shift+")}`);

interface Props {
  formats: Formats;
  disabled?: boolean;
  onFormat: (format: Format) => void;
  onBlock: (block: Block) => void;
  /** Links what's selected, written as `text`, or with null unlinks the link at the cursor. */
  onLink: (url: string | null, text: string) => void;
  /** What the Link field starts with: the text selected, or of the link at the cursor, and its address. */
  linkDraft: () => { text: string; url: string };
  /** Whether the link field is open, as Link or Ctrl or Cmd+K opens it. */
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
  /** Gives the text focus back, as a menu of the toolbar's closes. */
  onReturnFocus: () => void;
  /** Its tools, in groups, all of them unless a layout shows fewer, as a phone does. */
  groups?: typeof TOOL_GROUPS;
  className?: string;
}

/**
 * Slack's formatting toolbar, over the text: Bold, Italic, Underline, Strikethrough and the paragraph
 * style, then Link and the lists, then Blockquote, Code, Code block and Divider, each group ruled off
 * from the next. Each shows whether its format is on at the cursor, and inside code only the button
 * that turns the code off works. It scrolls sideways where it doesn't fit.
 */
export function ComposerToolbar({ formats, disabled = false, onFormat, onBlock, onLink, linkDraft, linkOpen, onLinkOpenChange, onReturnFocus, groups = TOOL_GROUPS, className }: Props) {
  // One stop for Tab, as a toolbar is: the button last focused, or the first that works where that can't,
  // and the arrow keys, Home and End move between them.
  const [current, setCurrent] = useState<Tool>("bold");
  const works = (tool: Tool) => !disabled && !isDisabled(tool, formats);
  const tabbable = works(current) ? current : groups.flat().find(({ tool }) => works(tool))?.tool;
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      onKeyDown={moveAlong}
      className={cn("-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto pb-1.5 [scrollbar-width:none]", className)}
    >
      {groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />}
          {group.map(({ tool, label, keys }) => {
            const title = keys ? `${label} (${keysOf(keys)})` : label;
            const common = {
              disabled: !works(tool),
              title,
              "aria-label": label,
              tabIndex: tool === tabbable ? 0 : -1,
              onFocus: () => setCurrent(tool),
              "data-tool": tool,
            };
            if (tool === "block") return <BlockMenu key={tool} block={formats.block} {...common} onBlock={onBlock} onReturnFocus={onReturnFocus} />;
            if (tool === "link") {
              return (
                <LinkField
                  key={tool}
                  {...common}
                  linked={formats.link}
                  open={linkOpen}
                  onOpenChange={onLinkOpenChange}
                  onLink={onLink}
                  draft={linkDraft}
                  onReturnFocus={onReturnFocus}
                />
              );
            }
            return (
              <button
                key={tool}
                type="button"
                {...common}
                aria-pressed={isActive(tool, formats)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onFormat(tool)}
                className={TOOL}
              >
                <ToolIcon tool={tool} />
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

/** Moves focus to the toolbar's next button that works, or the one before it, or its first or last, as the arrow keys, Home and End do. */
function moveAlong(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tool]:not(:disabled)")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
  if (at === -1 || next === undefined || buttons.length === 0) return;
  event.preventDefault();
  buttons[(next + buttons.length) % buttons.length]!.focus();
}

/** What every one of the toolbar's buttons takes, as `ComposerToolbar` gives it. */
interface ToolButton {
  disabled: boolean;
  title: string;
  "aria-label": string;
  tabIndex: number;
  onFocus: () => void;
  "data-tool": Tool;
}

interface BlockMenuProps extends ToolButton {
  block: Block;
  onBlock: (block: Block) => void;
  onReturnFocus: () => void;
}

/** The paragraph style menu: normal text, a heading or a subheading, for the lines at the cursor. */
function BlockMenu({ block, onBlock, onReturnFocus, ...button }: BlockMenuProps) {
  return (
    <PopoverMenu
      label="Paragraph style"
      onCloseFocus={onReturnFocus}
      trigger={
        <button type="button" {...button} aria-pressed={block !== "paragraph"} onMouseDown={(event) => event.preventDefault()} className={cn(TOOL, "w-9 gap-px touch:w-12")}>
          <ToolIcon tool="block" />
          <NavArrowDown className="size-2.5" />
        </button>
      }
      items={BLOCKS.map(({ block: kind, label }) => ({
        label,
        checked: kind === block,
        className: cn(kind === "heading" && "text-base font-bold", kind === "subheading" && "font-semibold"),
        onSelect: () => onBlock(kind),
      }))}
    />
  );
}

interface LinkFieldProps extends ToolButton {
  linked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (url: string | null, text: string) => void;
  draft: () => { text: string; url: string };
  onReturnFocus: () => void;
}

/** The Link field's text boxes, 36px tall, or 44px with 16px text on touch screens. */
const FIELD =
  "h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark aria-invalid:border-negative touch:h-11 touch:text-base";
const LABEL = "mb-1 block text-[13px] font-semibold";
/**
 * Link, which opens Slack's pair of fields above it: Text, what's selected or the link's own, and Link, its
 * address. Enter or Save links the text to the address, Cancel leaves it, and Remove link, there for a link
 * already, unlinks it. An address without a scheme gets https://, and one that isn't a web, mail or phone
 * address is refused.
 */
function LinkField({ linked, open, onOpenChange, onLink, draft, onReturnFocus, ...button }: LinkFieldProps) {
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  const [refused, setRefused] = useState(false);
  const ids = { text: useId(), address: useId() };
  // What's selected as it opens, however it opens: Link, or Ctrl or Cmd+K.
  const start = useEffectEvent(() => {
    const started = draft();
    setText(started.text);
    setAddress(started.url);
    setRefused(false);
  });
  useEffect(() => {
    if (open) start();
  }, [open]);
  const save = () => {
    const url = linkAddress(address);
    if (url === null) return setRefused(true);
    onLink(url, text.trim() === "" ? url : text);
    onOpenChange(false);
  };
  const saveOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    save();
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          type="button"
          {...button}
          aria-pressed={linked}
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpenChange(!open)}
          className={TOOL}
        >
          <ToolIcon tool="link" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <label htmlFor={ids.text} className={LABEL}>
          Text
        </label>
        <input id={ids.text} type="text" autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={saveOnEnter} className={cn(FIELD, "mb-2.5")} />
        <label htmlFor={ids.address} className={LABEL}>
          Link
        </label>
        <input
          id={ids.address}
          type="text"
          inputMode="url"
          autoComplete="off"
          // Where text is selected, the address is what's left to give.
          autoFocus
          value={address}
          aria-invalid={refused || undefined}
          onChange={(event) => {
            setAddress(event.target.value);
            setRefused(false);
          }}
          onKeyDown={saveOnEnter}
          className={FIELD}
        />
        {refused && (
          <p role="alert" className="mt-1.5 text-[12px] text-negative">
            Enter a web address, such as example.com.
          </p>
        )}
        <div className="mt-2.5 flex items-center justify-end gap-2">
          {linked && (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onLink(null, text);
              }}
              className={cn(TEXT_BUTTON, "mr-auto px-2.5 font-normal text-negative hover:bg-hover")}
            >
              Remove link
            </button>
          )}
          <button type="button" onClick={() => onOpenChange(false)} className={cn(TEXT_BUTTON, "hover:bg-hover")}>
            Cancel
          </button>
          <button type="button" onClick={save} className={cn(TEXT_BUTTON, "bg-foreground text-background hover:brightness-85")}>
            Save
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
