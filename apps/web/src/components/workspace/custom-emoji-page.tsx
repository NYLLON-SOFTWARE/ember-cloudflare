import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  CUSTOM_EMOJI_NAME_IS_STANDARD,
  CUSTOM_EMOJI_NAME_TAKEN,
  CUSTOM_EMOJI_TOO_LARGE,
  CUSTOM_EMOJI_TYPES,
  CUSTOM_EMOJI_WRONG_TYPE,
  customEmojiNameOf,
  customEmojiNameProblem,
  emojiCode,
  MAX_CUSTOM_EMOJI_NAME_LENGTH,
  MAX_CUSTOM_EMOJI_SIZE,
  type CustomEmoji,
  type Me,
} from "@ember/protocol";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { Trash } from "@/components/icons/iconoir";
import { Input } from "@/components/ui/input";
import { useCustomEmoji, type CustomEmojiByName } from "@/hooks/use-custom-emoji";
import { useNameOf } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { addCustomEmoji, ApiError, isSignedOut, removeCustomEmoji } from "@/lib/api";
import { loadEmoji } from "@/lib/emoji";
import { dateLabel } from "@/lib/messages";
import { customEmojiPictureOf } from "@/lib/previews";
import { cn } from "@/lib/utils";
import { CustomEmojiImage } from "./custom-emoji";
import { ROUND_BUTTON } from "./link-buttons";
import { ListRow } from "./list-row";
import { PageHeading, Panel, SECTION_HEADING, SettingsPage } from "./settings-page";

/** How many emoji the list has before it offers to search them. */
const SEARCHED_FROM = 8;

/** What's asked before an emoji goes, as Slack asks. */
const confirmRemoval = (name: string) => `Remove ${emojiCode(name)}? Messages and reactions that use it will show its name instead.`;

interface Props {
  me: Me;
  /** Lists an emoji added here at once, ahead of the workspace socket saying so. */
  onAdded: (emoji: CustomEmoji) => void;
  /** And lists one removed here no longer. */
  onRemoved: (name: string) => void;
  /** Says why adding or removing failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * Custom emoji, as Slack's Customize page has them: anyone adds one, a picture and the name it's typed by
 * between colons, and it's everyone's to use at once, in messages and as reactions. Under the form, every
 * emoji the workspace has, by name, with who added it and when; whoever added one can remove it, and
 * administrators can remove any.
 */
export function CustomEmojiPage({ me, onAdded, onRemoved, onFailed }: Props) {
  const emoji = useCustomEmoji();
  useTitle("Custom emoji");
  return (
    <SettingsPage back={WORKSPACE_SETTINGS_PATH}>
      <Panel aria-labelledby="custom-emoji-heading" className="flex flex-col gap-6">
        <PageHeading id="custom-emoji-heading" title="Custom emoji" className="mb-0">
          Add emoji of your own for everyone here to use. Type one by its name between colons, like <code>:shipit:</code>, in a message or as a reaction.
        </PageHeading>
        <AddEmoji emoji={emoji} onAdded={onAdded} onFailed={onFailed} />
        <EmojiList emoji={[...emoji.values()]} me={me} onRemoved={onRemoved} onFailed={onFailed} />
      </Panel>
    </SettingsPage>
  );
}

/** The emoji's own codes, once they've loaded, which no custom emoji takes. The Worker refuses one the app let through. */
function useStandardCodes(): ReadonlySet<string> | null {
  const [codes, setCodes] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let current = true;
    loadEmoji().then(
      (index) => current && setCodes(new Set(index.byCode.keys())),
      () => {},
    );
    return () => void (current = false);
  }, []);
  return codes;
}

/** A picture chosen for an emoji: what's sent, and where it shows from meanwhile. */
interface ChosenPicture {
  picture: Blob;
  preview: string;
}

/**
 * The form that adds an emoji: Choose an image, which shows the picture as it'll look in a message, in
 * light and dark, then its name, filled in from the file's as Slack fills it, and Add emoji. A picture
 * is scaled to fit 128×128 here, but for a GIF, which is sent as it is so it stays animated. What's wrong
 * with the picture or the name shows under its field.
 */
function AddEmoji({ emoji, onAdded, onFailed }: { emoji: CustomEmojiByName; onAdded: (emoji: CustomEmoji) => void; onFailed: (error: unknown) => void }) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<ChosenPicture | null>(null);
  // How many pictures have been picked, so the last is told from one before it that's still being scaled.
  const choices = useRef(0);
  const [pictureProblem, setPictureProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  // What the Worker said of the name sent last, until it's changed.
  const [refusedName, setRefusedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const standard = useStandardCodes();
  const flash = useFlash();
  const mounted = useMounted();

  // A preview's address is let go of once another takes its place, or the form goes.
  useEffect(() => () => void (chosen && URL.revokeObjectURL(chosen.preview)), [chosen]);

  const nameProblem = useMemo(() => {
    if (name === "") return null;
    if (standard?.has(name)) return CUSTOM_EMOJI_NAME_IS_STANDARD;
    return customEmojiNameProblem(name) ?? (emoji.has(name) ? CUSTOM_EMOJI_NAME_TAKEN : null);
  }, [name, standard, emoji]);
  const shownNameProblem = refusedName ?? nameProblem;

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // The field forgets it, so picking the same file again picks it again.
    event.target.value = "";
    if (!picked) return;
    const choice = ++choices.current;
    setChosen(null);
    if (!CUSTOM_EMOJI_TYPES.includes(picked.type)) return setPictureProblem(CUSTOM_EMOJI_WRONG_TYPE);
    const picture = await customEmojiPictureOf(picked);
    // A picture picked since is the one wanted, however long this one took to scale.
    if (!mounted.current || choice !== choices.current) return;
    if (picture.size > MAX_CUSTOM_EMOJI_SIZE) return setPictureProblem(CUSTOM_EMOJI_TOO_LARGE);
    setPictureProblem(null);
    setChosen({ picture, preview: URL.createObjectURL(picture) });
    if (name === "") setName(customEmojiNameOf(picked.name));
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen || name === "" || shownNameProblem || saving) return;
    setSaving(true);
    addCustomEmoji(name, chosen.picture).then(
      (emoji) => {
        onAdded(emoji);
        if (!mounted.current) return;
        setSaving(false);
        setChosen(null);
        setName("");
        flash("notice", `${emojiCode(emoji.name)} added`);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        if (error instanceof ApiError && error.field === "name") return setRefusedName(error.message);
        if (error instanceof ApiError && [413, 415].includes(error.status)) return setPictureProblem(error.message);
        onFailed(error);
      },
    );
  };

  return (
    <form onSubmit={add} aria-label="Add custom emoji" className="flex flex-col gap-4 rounded-[10px] border bg-surface px-[2ch] py-4">
      <div className="flex flex-wrap items-center gap-x-[2ch] gap-y-3">
        <input ref={file} id={`${id}-image`} type="file" accept={CUSTOM_EMOJI_TYPES.join(",")} className="sr-only" onChange={(event) => void choose(event)} aria-describedby={`${id}-image-hint`} />
        <label
          htmlFor={`${id}-image`}
          className="inline-flex min-h-[42px] cursor-pointer items-center justify-center rounded-[9px] border bg-background px-3.5 py-2 font-medium touch:min-h-11 [input:focus-visible+&]:outline-2 [input:focus-visible+&]:outline-offset-3 [input:focus-visible+&]:outline-solid [input:focus-visible+&]:outline-foreground"
        >
          {chosen ? "Choose another image" : "Choose an image"}
        </label>
        {chosen && <Preview src={chosen.preview} />}
        <p id={`${id}-image-hint`} className={cn("basis-full text-[13px]", pictureProblem ? "text-negative" : "text-muted-foreground")} role={pictureProblem ? "alert" : undefined}>
          {pictureProblem ?? "A square PNG, JPEG, GIF or WebP works best. It's scaled to fit 128×128, and an animated GIF is kept as it is, up to 256 KB."}
        </p>
      </div>
      <Field id={`${id}-name`} label="Name">
        <div className="flex items-center gap-[1.25ch]">
          <span aria-hidden className="text-muted-foreground">
            :
          </span>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={MAX_CUSTOM_EMOJI_NAME_LENGTH}
            placeholder="shipit"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={shownNameProblem ? true : undefined}
            aria-describedby={`${id}-name-hint`}
            // Names are lowercase, so capitals are lowered as they're typed, as Slack lowers them.
            onChange={(event) => {
              setName(event.target.value.toLowerCase());
              setRefusedName(null);
            }}
            className={cn(FIELD_INPUT, "min-w-0 flex-1")}
          />
          <span aria-hidden className="text-muted-foreground">
            :
          </span>
        </div>
        <p id={`${id}-name-hint`} className={cn("text-[13px]", shownNameProblem ? "text-negative" : "text-muted-foreground")} role={shownNameProblem ? "alert" : undefined}>
          {shownNameProblem ?? "Lowercase letters, numbers, underscores, hyphens and plus signs."}
        </p>
      </Field>
      <SubmitButton disabled={!chosen || name === "" || shownNameProblem !== null || saving} className="w-auto self-start">
        Add emoji
      </SubmitButton>
    </form>
  );
}

/** The picture chosen as it'll show in a line of a message, on the light and the dark of a message's background. */
function Preview({ src }: { src: string }) {
  const emoji = <img src={src} alt="" className="inline-block size-[1.375em] object-contain align-[-0.3em]" />;
  return (
    <div className="flex items-center gap-[1ch]" aria-label="Preview">
      <span className="rounded-[9px] border bg-white px-3 py-2 text-black">{emoji}</span>
      <span className="rounded-[9px] border bg-black px-3 py-2 text-white">{emoji}</span>
    </div>
  );
}

/**
 * The workspace's emoji, by name: each one's picture, its code, who added it and when, and Remove for
 * those you may remove. Once there are a few, a field searches them by name.
 */
function EmojiList({ emoji, me, onRemoved, onFailed }: { emoji: CustomEmoji[]; me: Me; onRemoved: (name: string) => void; onFailed: (error: unknown) => void }) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const nameOf = useNameOf();
  const flash = useFlash();
  const mounted = useMounted();
  const sorted = useMemo(() => emoji.toSorted((a, b) => a.name.localeCompare(b.name)), [emoji]);
  const found = search === "" ? sorted : sorted.filter(({ name }) => name.includes(search.toLowerCase()));

  const remove = ({ name }: CustomEmoji) => {
    if (removing || !confirm(confirmRemoval(name))) return;
    setRemoving(name);
    removeCustomEmoji(name).then(
      () => {
        onRemoved(name);
        if (!mounted.current) return;
        setRemoving(null);
        flash("notice", `${emojiCode(name)} removed`);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setRemoving(null);
        // Someone else removed it first, which is what was asked for.
        if (error instanceof ApiError && error.status === 404) return onRemoved(name);
        onFailed(error);
      },
    );
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h2 id={`${id}-heading`} className={cn(SECTION_HEADING, "text-[17px] font-[650]")}>
        {emoji.length === 0 ? "No custom emoji yet" : `${emoji.length.toLocaleString("en-US")} custom emoji`}
      </h2>
      {/* Kept while it's searching, though removing emoji leaves fewer than it shows for. */}
      {(emoji.length >= SEARCHED_FROM || search !== "") && (
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search emoji by name…"
          aria-label="Search emoji by name"
          autoComplete="off"
          className={FIELD_INPUT}
        />
      )}
      {emoji.length === 0 && <p className="text-muted-foreground">The first one you add shows here.</p>}
      {emoji.length > 0 && found.length === 0 && <p className="text-muted-foreground">No emoji match “{search}”.</p>}
      <ul className="flex flex-col gap-3">
        {found.map((listed) => (
          <ListRow key={listed.name} figure={<CustomEmojiImage emoji={listed} className="size-8 flex-none align-middle" />} name={emojiCode(listed.name)}>
            <span className="min-w-0 shrink text-[13px] text-muted-foreground max-md:hidden">
              Added by {nameOf({ id: listed.creatorId, name: "someone" })} on <time dateTime={listed.createdAt}>{dateLabel(new Date(listed.createdAt))}</time>
            </span>
            {(me.administrator || listed.creatorId === me.id) && (
              <button type="button" disabled={removing !== null} onClick={() => remove(listed)} className={ROUND_BUTTON}>
                <Trash className="size-[1.3em]" />
                <span className="sr-only">Remove {emojiCode(listed.name)}</span>
              </button>
            )}
          </ListRow>
        ))}
      </ul>
    </section>
  );
}
