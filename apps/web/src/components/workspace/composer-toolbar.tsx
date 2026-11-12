import { Fragment, useId, useState } from "react";
import { NavArrowDown } from "@/components/icons/iconoir";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { appleKeyboard } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { BLOCKS, isActive, isDisabled, linkAddress, TOOL_GROUPS, type Block, type Format, type Formats, type Tool } from "./formatting";
import { PopoverMenu } from "./popover-menu";

/**
 * A toolbar button, as Slack's: a 28px square, or a fingertip's 44px on touch screens, that's tinted while
 * its format is on at the cursor and faded while it can't be used there. It keeps focus in the text, so a
 * phone's keyboard stays up.
 */
const TOOL =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground touch:size-11 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground aria-pressed:bg-hover aria-pressed:text-foreground disabled:pointer-events-none disabled:opacity-35";

/** Iconoir's icon for each button, painted from its file (rich-text-editor.css). */
function ToolIcon({ tool }: { tool: Tool }) {
  return <span aria-hidden="true" data-icon={tool} className="composer-tool-icon size-[18px]" />;
}

/** A tool's keys, as its tooltip shows them: Cmd's ⌘ on an Apple keyboard, Ctrl+ on another. */
const keysOf = (keys: string) => (appleKeyboard() ? `⌘${keys}` : `Ctrl+${keys.replace("⇧", "Shift+")}`);

interface Props {
  formats: Formats;
  disabled?: boolean;
  onFormat: (format: Format) => void;
  onBlock: (block: Block) => void;
  /** Links what's selected, or with null unlinks the link at the cursor. */
  onLink: (url: string | null) => void;
  /** Whether the link field is open, as Link or Ctrl or Cmd+K opens it. */
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
  /** Gives the text focus back, as a menu of the toolbar's closes. */
  onReturnFocus: () => void;
}

/**
 * Slack's formatting toolbar, over the text: Bold, Italic, Underline, Strikethrough and the paragraph
 * style, then Link and the lists, then Blockquote, Code, Code block and Divider, each group ruled off
 * from the next. Each shows whether its format is on at the cursor, and inside code only the button
 * that turns the code off works. It scrolls sideways where it doesn't fit.
 */
export function ComposerToolbar({ formats, disabled = false, onFormat, onBlock, onLink, linkOpen, onLinkOpenChange, onReturnFocus }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto pb-1.5 [scrollbar-width:none]"
    >
      {TOOL_GROUPS.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />}
          {group.map(({ tool, label, keys }) => {
            const title = keys ? `${label} (${keysOf(keys)})` : label;
            const common = { disabled: disabled || isDisabled(tool, formats), title, "aria-label": label };
            if (tool === "block") return <BlockMenu key={tool} block={formats.block} {...common} onBlock={onBlock} onReturnFocus={onReturnFocus} />;
            if (tool === "link") {
              return (
                <LinkField key={tool} {...common} linked={formats.link} open={linkOpen} onOpenChange={onLinkOpenChange} onLink={onLink} onReturnFocus={onReturnFocus} />
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

interface BlockMenuProps {
  block: Block;
  disabled: boolean;
  title: string;
  "aria-label": string;
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

interface LinkFieldProps {
  disabled: boolean;
  title: string;
  "aria-label": string;
  linked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (url: string | null) => void;
  onReturnFocus: () => void;
}

/**
 * Link, which opens a field for the address above it: Enter or Save links what's selected to it, or
 * writes it linked where nothing is, and Remove link unlinks the link at the cursor. An address without a
 * scheme gets https://, and one that isn't a web, mail or phone address is refused.
 */
function LinkField({ linked, open, onOpenChange, onLink, onReturnFocus, ...button }: LinkFieldProps) {
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState(false);
  const fieldId = useId();
  const save = () => {
    const url = linkAddress(typed);
    if (url === null) return setRefused(true);
    onLink(url);
    onOpenChange(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setTyped("");
        setRefused(false);
        onOpenChange(open);
      }}
    >
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
        <label htmlFor={fieldId} className="mb-1.5 block text-[13px] font-semibold">
          Link
        </label>
        <input
          id={fieldId}
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://example.com"
          value={typed}
          aria-invalid={refused || undefined}
          onChange={(event) => {
            setTyped(event.target.value);
            setRefused(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            save();
          }}
          className="h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark aria-invalid:border-negative touch:h-11 touch:text-base"
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
                onLink(null);
              }}
              className="mr-auto cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] text-negative hover:bg-hover touch:min-h-11"
            >
              Remove link
            </button>
          )}
          <button type="button" onClick={save} className="cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-[13px] font-semibold text-background hover:brightness-85 touch:min-h-11">
            Save
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
