import { useEffect, useState, type FormEvent } from "react";
import { MAX_PROFILE_FIELD_NAME_LENGTH, MAX_PROFILE_FIELDS, PROFILE_FIELD_OPTIONS_REFUSED, PROFILE_FIELDS_FULL, type ProfileField } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { FIELD_INPUT, Field } from "@/components/field";
import { ArrowDown, ArrowUp, EditPencil, Plus, Trash } from "@/components/icons/iconoir";
import { fetchProfileFields, addProfileField, changeProfileField, deleteProfileField, isSignedOut, reorderProfileFields } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BUTTON } from "./email-settings";
import { SELECT } from "./model-picker";
import { CHANGES_SAVED } from "./settings-page";

// Profile fields on workspace settings, for administrators: the fields everyone's profile shows, a row
// each with its kind, then the form that adds one, text or with set choices. A row's arrows move it up
// or down, its pencil renames it and edits its choices, and its bin takes it away, with what anyone
// saved for it.

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

/** What Delete asks before taking a field away. */
export const CONFIRM_REMOVE_FIELD = "Delete this field? Everyone's answer to it goes with it. This can’t be undone.";

/** The kinds of field, as the form names them. */
const KINDS = { text: "Plain text", choices: "Set choices" } as const;
type Kind = keyof typeof KINDS;

/** The field being renamed, with what's typed in its form. */
interface Editing {
  id: string;
  name: string;
  choices: string;
}

/** What the form that adds a field holds. */
interface Adding {
  name: string;
  kind: Kind;
  choices: string;
}

/** `text` as lines, which an options editor keeps one choice in each. */
const linesOf = (options: string[] | null) => (options === null ? "" : options.join("\n"));

/** The choices `text` keeps, one in each line, without the blanks, or null for plain text. */
const choicesOf = (text: string): string[] | null => {
  const options = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return options.length === 0 ? null : options;
};

interface Props {
  /** Says why loading or saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** A row's round buttons, which its arrows, pencil and bin are. */
const ROUND = "grid size-9 flex-none cursor-pointer place-items-center rounded-full border bg-background touch:size-11 disabled:pointer-events-none disabled:opacity-50";

/** A row that's being edited, or the form that adds a field. */
const FORM = "flex flex-col gap-3 rounded-[10px] border bg-surface p-4";

/**
 * The Profile fields card on workspace settings: the fields in the order their profiles show them, each
 * said to take plain text or its choices, moved with its arrows, renamed and given choices with its
 * pencil, and taken away with its bin, then the form that adds one. Save changes saves each at once,
 * with the notice, and an answer the workspace refuses says why.
 */
export function ProfileFieldsSettings({ onFailed }: Props) {
  const [fields, setFields] = useState<ProfileField[] | null>(null);
  /** The field being renamed, with what's typed in its form. */
  const [editing, setEditing] = useState<Editing | null>(null);
  /** What the add form holds. */
  const [adding, setAdding] = useState<Adding>({ name: "", kind: "text", choices: "" });
  /** What's on its way to the server: "add", or a field's id. */
  const [busy, setBusy] = useState<string | null>(null);
  const flash = useFlash();

  useEffect(() => {
    let stopped = false;
    fetchProfileFields().then(
      // A workspace without any, which a loose answer may say by leaving them out, has none.
      (fields) => !stopped && setFields(fields ?? []),
      (error: unknown) => {
        // A card gone before its fields load only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [onFailed]);

  /** Shows the fields `change` answers with, saying nothing. */
  const shown = (change: Promise<ProfileField[]>, settled?: () => void) =>
    change.then(
      (fields) => {
        setFields(fields);
        setBusy(null);
        settled?.();
      },
      (error: unknown) => {
        setBusy(null);
        onFailed(error);
      },
    );

  const addField = (event: FormEvent) => {
    event.preventDefault();
    const name = adding.name.trim();
    if (!name || busy) return;
    const choices = adding.kind === "choices" ? choicesOf(adding.choices) : null;
    // Set choices need at least one choice to take, which the server refuses too, as does an empty list.
    if (adding.kind === "choices" && choices === null) return flash("alert", PROFILE_FIELD_OPTIONS_REFUSED);
    const sent = adding;
    setBusy("add");
    shown(addProfileField({ name, options: choices }), () => {
      // The form empties only while it still holds what was sent, so what's typed meanwhile stays.
      setAdding((typed) =>
        typed.name === sent.name && typed.kind === sent.kind && typed.choices === sent.choices ? { name: "", kind: "text", choices: "" } : typed,
      );
      flash("notice", CHANGES_SAVED);
    });
  };

  /** Puts the pencil to `field`, with its name and choices in the form. */
  const edit = (field: ProfileField) => setEditing({ id: field.id, name: field.name, choices: linesOf(field.options) });

  const saveEdited = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null || !editing.name.trim() || busy) return;
    const sent = editing;
    setBusy(sent.id);
    shown(changeProfileField(sent.id, { name: sent.name.trim(), options: choicesOf(sent.choices) }), () => {
      // The form closes only while it still holds what was sent, so what's typed meanwhile stays.
      setEditing((typed) => (typed !== null && typed.id === sent.id && typed.name === sent.name && typed.choices === sent.choices ? null : typed));
      flash("notice", CHANGES_SAVED);
    });
  };

  /** Moves `field` one place up, or down, answering the fields as they are then. */
  const move = (field: ProfileField, up: boolean) => {
    if (busy || fields === null) return;
    const at = fields.findIndex(({ id }) => id === field.id);
    const other = up ? at - 1 : at + 1;
    if (other < 0 || other >= fields.length) return;
    const ids = fields.map(({ id }) => id);
    ids.splice(at, 1);
    ids.splice(other, 0, field.id);
    setBusy(field.id);
    shown(reorderProfileFields(ids));
  };

  const remove = (field: ProfileField) => {
    if (busy || !confirm(CONFIRM_REMOVE_FIELD)) return;
    setBusy(field.id);
    shown(deleteProfileField(field.id));
  };

  const full = fields !== null && fields.length >= MAX_PROFILE_FIELDS;

  return (
    <div aria-busy={fields === null} className="flex flex-col gap-4">
      <p className={NOTE}>
        Ask everyone the same things, up to {MAX_PROFILE_FIELDS}, and people fill them in on their own profile. People’s pages show the ones they answered.
      </p>
      {fields !== null && fields.length === 0 && <p className={NOTE}>No fields yet. Add one below.</p>}
      {fields !== null && (
        <ul aria-label="Profile fields" className="flex flex-col">
          {fields.map((field, at) => (
            <li key={field.id} className="border-t py-3 first:border-t-0 first:pt-0">
              {editing !== null && editing.id === field.id ? (
                <form onSubmit={saveEdited} className={FORM} aria-label={`Edit ${field.name}`}>
                  <Field id={`edit_field_name_${field.id}`} label="Name">
                    <input
                      id={`edit_field_name_${field.id}`}
                      autoComplete="off"
                      maxLength={MAX_PROFILE_FIELD_NAME_LENGTH}
                      value={editing.name}
                      onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                      className={FIELD_INPUT}
                    />
                  </Field>
                  {field.options !== null && (
                    <Field id={`edit_field_options_${field.id}`} label="Choices, one per line">
                      <textarea
                        id={`edit_field_options_${field.id}`}
                        rows={Math.max(2, field.options.length + 1)}
                        value={editing.choices}
                        onChange={(event) => setEditing({ ...editing, choices: event.target.value })}
                        className={cn("w-full border placeholder:text-muted-foreground disabled:opacity-50", FIELD_INPUT, "resize-y")}
                      />
                    </Field>
                  )}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditing(null)} className={cn(BUTTON, "bg-background")}>
                      Cancel
                    </button>
                    <button type="submit" disabled={busy !== null || editing.name.trim() === ""} className={cn(BUTTON, "border-transparent bg-foreground text-background hover:not-active:brightness-70")}>
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-x-[1ch]">
                  {/* Where it comes in the profile, which people see the fields in. */}
                  <span aria-hidden="true" className={cn(NOTE, "w-[2ch] flex-none text-end tabular-nums")}>
                    {at + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-[550]">{field.name}</div>
                    <div className={NOTE}>{field.options === null ? KINDS.text : `${KINDS.choices}: ${field.options.join(", ")}`}</div>
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Move ${field.name} up`}
                      disabled={busy !== null || at === 0}
                      onClick={() => move(field, true)}
                      className={ROUND}
                    >
                      <ArrowUp className="size-[1.3em]" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${field.name} down`}
                      disabled={busy !== null || at === fields.length - 1}
                      onClick={() => move(field, false)}
                      className={ROUND}
                    >
                      <ArrowDown className="size-[1.3em]" />
                    </button>
                    <button type="button" aria-label={`Edit ${field.name}`} disabled={busy !== null} onClick={() => edit(field)} className={ROUND}>
                      <EditPencil className="size-[1.3em]" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${field.name}`}
                      disabled={busy !== null}
                      onClick={() => remove(field)}
                      className={cn(ROUND, "text-negative hover:not-active:bg-surface")}
                    >
                      <Trash className="size-[1.3em]" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className={NOTE}>{PROFILE_FIELDS_FULL}</p>
      ) : (
        <form onSubmit={addField} className={FORM} aria-label="Add a profile field">
          <Field id="new_field_name" label="Name">
            <input
              id="new_field_name"
              autoComplete="off"
              placeholder="Title"
              maxLength={MAX_PROFILE_FIELD_NAME_LENGTH}
              value={adding.name}
              onChange={(event) => setAdding({ ...adding, name: event.target.value })}
              className={FIELD_INPUT}
            />
          </Field>
          <Field id="new_field_kind" label="Kind">
            <select id="new_field_kind" value={adding.kind} onChange={(event) => setAdding({ ...adding, kind: event.target.value as Kind })} className={SELECT}>
              <option value="text">{KINDS.text}</option>
              <option value="choices">{KINDS.choices}</option>
            </select>
          </Field>
          {adding.kind === "choices" && (
            <Field id="new_field_choices" label="Choices, one per line">
              <textarea
                id="new_field_choices"
                rows={3}
                placeholder={"Design\nEngineering\nOperations"}
                value={adding.choices}
                onChange={(event) => setAdding({ ...adding, choices: event.target.value })}
                className={cn("w-full border placeholder:text-muted-foreground disabled:opacity-50", FIELD_INPUT, "resize-y")}
              />
            </Field>
          )}
          <button type="submit" disabled={busy !== null || adding.name.trim() === ""} className={cn(BUTTON, "self-end border-transparent bg-foreground text-background hover:not-active:brightness-70")}>
            <Plus className="size-[18px]" />
            <span>Add field</span>
          </button>
        </form>
      )}
    </div>
  );
}
