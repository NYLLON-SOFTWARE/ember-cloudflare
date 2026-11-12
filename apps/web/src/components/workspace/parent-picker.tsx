import { useId } from "react";
import type { ParentChoice, RoomId } from "@ember/protocol";
import { FIELD_INPUT, Field } from "@/components/field";
import { toSentence } from "@/lib/directs";
import { cn } from "@/lib/utils";

/** A select as the settings pages draw theirs. */
const SELECT = cn("w-full min-w-0 border outline-none dark:bg-input/30", FIELD_INPUT);

/** What the room forms' Parent room field shows and changes. */
export interface ParentField {
  /** The room it's under, or null for a room of its own. */
  value: RoomId | null;
  /** The rooms it could go under. */
  choices: ParentChoice[];
  onChange: (parentId: RoomId | null) => void;
  /** Why it can't go under a room, as while it has sub-rooms of its own, which keeps the field as it is. */
  locked?: string;
  /** Who'd lose access to the room were it saved under the parent picked, not being in it, by name. */
  leaving?: string[];
}

/** The parent `parentId` names among `choices`, if it's one of them. */
export const parentChoice = (choices: ParentChoice[], parentId: RoomId | null) => choices.find((choice) => choice.id === parentId) ?? null;

/** What saving a room under `parent` would take from the people `leaving` names, for the form and its confirmation. */
export const leavingWarning = (parent: string, leaving: string[]) =>
  `Moving this room under ${parent} removes ${toSentence(leaving)}, who ${leaving.length === 1 ? "isn’t" : "aren’t"} in ${parent}.`;

/**
 * The room forms' Parent room: None, for a room of its own, or a room it goes under as a sub-room. Below
 * it, a warning names whoever the room would lose, not being in the parent picked.
 */
export function ParentPicker({ value, choices, onChange, locked, leaving = [], disabled }: ParentField & { disabled: boolean }) {
  const hintId = useId();
  const warningId = useId();
  const parent = parentChoice(choices, value);
  return (
    <div className="mt-[22px]">
      <Field id="room_parent" label="Parent room">
        <select
          id="room_parent"
          value={value ?? ""}
          disabled={disabled || locked !== undefined}
          aria-describedby={cn(hintId, leaving.length > 0 && parent && warningId)}
          onChange={(event) => onChange(event.target.value || null)}
          className={SELECT}
        >
          <option value="">None, a room of its own</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      </Field>
      <p id={hintId} className="mt-2 text-xs text-muted-foreground">
        {locked ?? "A sub-room is listed under its room, and only people in that room can be in it."}
      </p>
      {leaving.length > 0 && parent && (
        <p id={warningId} role="status" className="mt-2 text-xs text-negative wrap-anywhere">
          {leavingWarning(parent.name, leaving)}
        </p>
      )}
    </div>
  );
}
