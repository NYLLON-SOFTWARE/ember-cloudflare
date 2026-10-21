import { useId, useMemo, useState } from "react";
import type { Card, CardButton, CardField, CardImage, CardPart } from "@ember/protocol";
import { cardAddress, displayBody, type DisplayNode } from "@ember/richtext/dom";
import { Button } from "@/components/ui/button";
import { dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { MessageBody, MessageLink } from "./message-body";

// A bot's cards (packages/protocol/src/cards.ts), which a Slack-compatible webhook's legacy attachments show
// under its message. ember-rust has no cards, so they're Ember's own: framed as a link preview is
// (message-body.tsx) and laid out as Slack lays out an attachment. The room kept only addresses on named
// hosts, and each is checked again here against the page's own host, which a card can't aim at, as a link
// preview can't, since every reader's browser would fetch it signed in.

/** The bars of Slack's named colors, in Ember's: a notice's green, the warning amber and an alert's red. */
const BARS = new Map([
  ["good", "bg-positive"],
  ["warning", "bg-warning"],
  ["danger", "bg-negative"],
]);

/** How much text shows before a card folds the rest behind Show more. */
const FOLD_CHARACTERS = 700;
const FOLD_LINE_BREAKS = 5;

/** Elements that start a line of their own. */
const BLOCKS = new Set(["p", "div", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** A message's cards, one under another. */
export function BotCards({ cards, className }: { cards: Card[]; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 pt-1", className)}>
      {cards.map((card, index) => (
        <BotCard key={index} card={card} />
      ))}
    </div>
  );
}

/**
 * A card, 38rem wide or as wide as there's room for: its pretext, then a frame with a 4px bar down its left
 * side in its color, holding its parts and its thumbnail at the right. Its fields take one column in a frame
 * under 400px wide. It's an article named by its title.
 */
function BotCard({ card }: { card: Card }) {
  const titleId = useId();
  const title = card.parts.find((part) => part.kind === "title");
  const thumb = card.thumb && shownImage(card.thumb);
  const bar = card.color === undefined ? "bg-border" : BARS.get(card.color);
  return (
    <div className="w-[38rem] max-w-full">
      {card.pretext !== undefined && <CardText html={card.pretext} className="pb-1" />}
      <article
        aria-labelledby={title && titleId}
        className="@container relative flex gap-[1.5ch] overflow-clip rounded-[0.5em] border bg-background py-3 ps-[calc(1.5ch+4px)] pe-[1.5ch]"
      >
        <span aria-hidden className={cn("absolute inset-y-0 start-0 w-1", bar)} style={bar ? undefined : { backgroundColor: card.color }} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {card.parts.map((part, index) => (
            <Part key={index} part={part} titleId={part === title ? titleId : undefined} />
          ))}
        </div>
        {thumb && <img src={thumb.url} alt={thumb.alt} loading="lazy" className="size-[75px] shrink-0 rounded-[6px] object-cover" />}
      </article>
    </div>
  );
}

/** One of a card's parts, as Slack shows an attachment's: the first title gets `titleId`, which names the card. */
function Part({ part, titleId }: { part: CardPart; titleId?: string }) {
  switch (part.kind) {
    case "author":
      return (
        <div className="flex min-w-0 items-center gap-[0.5ch] text-[13px] leading-[18px] font-semibold text-message-muted">
          <Icon url={part.icon} />
          <span className="min-w-0 wrap-anywhere">
            <Linked href={part.href}>{part.name}</Linked>
          </span>
        </div>
      );
    case "title":
      return (
        <h4 id={titleId} className="text-[15px] leading-[22px] font-semibold wrap-anywhere text-message-ink">
          <Linked href={part.href} className="text-link">
            {part.text}
          </Linked>
        </h4>
      );
    case "text":
      return <CardText html={part.html} folds />;
    case "fields":
      return <Fields fields={part.fields} />;
    case "image":
      return <Image image={part.image} />;
    case "buttons":
      return <Buttons buttons={part.buttons} />;
    case "footer":
      return <Footer text={part.text} icon={part.icon} at={part.at} />;
  }
}

/**
 * Rich text in a card, as a message's text shows. Where it `folds`, text past 700 characters or 5 line breaks
 * folds behind Show more, as Slack folds an attachment's.
 */
function CardText({ html, folds = false, className }: { html: string; folds?: boolean; className?: string }) {
  const nodes = useMemo(() => shownText(html), [html]);
  const [open, setOpen] = useState(false);
  if (nodes === null) return null;
  const long = folds && isLong(nodes);
  return (
    <div className={className}>
      <MessageBody nodes={nodes} mentions={[]} className={cn(long && !open && "max-h-[5lh] overflow-hidden")} />
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="cursor-pointer text-sm font-medium text-link hover:underline touch:min-h-11"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** A card's fields: short ones two to a row, the rest the whole width, each title in small bold over its value. */
function Fields({ fields }: { fields: CardField[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-[2ch] gap-y-2 pt-1 @max-[400px]:grid-cols-1">
      {fields.map((field, index) => (
        <div key={index} className={cn("min-w-0", !field.short && "col-span-full")}>
          {field.title !== undefined && <div className="text-[13px] leading-[18px] font-semibold wrap-anywhere text-message-muted">{field.title}</div>}
          {field.html !== "" && <CardText html={field.html} />}
        </div>
      ))}
    </div>
  );
}

/**
 * A card's image, at most 360px wide and 500px tall, loading as it nears the screen, linked to itself: the link
 * is named by what the image shows, or by its host where the payload doesn't say, as an attachment's never does.
 */
function Image({ image }: { image: CardImage }) {
  const shown = shownImage(image);
  if (!shown) return null;
  return (
    <MessageLink href={shown.url} aria-label={shown.alt === "" ? `Image from ${new URL(shown.url).hostname}` : undefined} className="block w-fit max-w-full pt-1">
      <img src={shown.url} alt={shown.alt} loading="lazy" className="max-h-[500px] max-w-[min(100%,360px)] rounded-[6px] object-contain" />
    </MessageLink>
  );
}

/** A card's link buttons, bordered, filled for `primary`, and red for `danger`, as Delete is in both modes. */
function Buttons({ buttons }: { buttons: CardButton[] }) {
  const shown = buttons.flatMap((button) => {
    const href = shownAddress(button.href);
    return href ? [{ ...button, href }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {shown.map(({ text, href, style }, index) => (
        <Button
          key={index}
          asChild
          size="sm"
          variant={style ? "default" : "outline"}
          className={cn("max-w-full touch:min-h-11", style === "danger" && "bg-negative-button text-white hover:bg-negative-button/90")}
        >
          <MessageLink href={href}>
            <span className="truncate">{text}</span>
          </MessageLink>
        </Button>
      ))}
    </div>
  );
}

/** A card's footer, in small gray type: its icon, its text and its moment, in the reader's time zone. */
function Footer({ text, icon, at }: { text?: string; icon?: string; at?: number }) {
  const moment = at === undefined ? undefined : new Date(at * 1000);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-[0.5ch] pt-1 text-xs text-message-muted">
      <Icon url={icon} />
      {text !== undefined && <span className="min-w-0 wrap-anywhere">{text}</span>}
      {text !== undefined && moment && <span aria-hidden>·</span>}
      {moment && <time dateTime={moment.toISOString()}>{dateTimeLabel(moment)}</time>}
    </div>
  );
}

/** An author's or a footer's 16px icon, which says nothing its text doesn't. */
function Icon({ url }: { url?: string }) {
  const src = url && shownAddress(url);
  return src ? <img src={src} alt="" loading="lazy" className="size-4 shrink-0 rounded-[4px]" /> : null;
}

/** `children`, linked to `href` when the card may link there. */
function Linked({ href, className, children }: { href?: string; className?: string; children: string }) {
  const shown = href && shownAddress(href);
  return shown ? (
    <MessageLink href={shown} className={cn("hover:underline", className)}>
      {children}
    </MessageLink>
  ) : (
    children
  );
}

/** What a card's rich text shows, or null when it can't be shown, as a message whose text can't be shown goes. */
function shownText(html: string): DisplayNode[] | null {
  try {
    return displayBody(html, "", location.hostname);
  } catch (error) {
    console.error("Could not show a card's text", error);
    return null;
  }
}

/** Whether text runs past 700 characters or 5 line breaks. */
function isLong(nodes: DisplayNode[]): boolean {
  let characters = 0;
  // The first line starts none.
  let lineBreaks = -1;
  const count = (node: DisplayNode) => {
    if (node.kind === "text") {
      characters += node.value.length;
      lineBreaks += node.value.split("\n").length - 1;
    } else if (node.kind === "element") {
      if (node.name === "br" || BLOCKS.has(node.name)) lineBreaks++;
      node.children.forEach(count);
    }
  };
  nodes.forEach(count);
  return characters > FOLD_CHARACTERS || lineBreaks > FOLD_LINE_BREAKS;
}

/** An address a card may show, unless it's on the page's own host. */
const shownAddress = (url: string) => cardAddress(url, location.hostname);

function shownImage(image: CardImage): CardImage | undefined {
  const url = shownAddress(image.url);
  return url === undefined ? undefined : { ...image, url };
}
