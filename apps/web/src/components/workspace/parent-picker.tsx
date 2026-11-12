import { useId } from "react";
import type { ParentChoice, RoomId } from "@ember/protocol";
import { FIELD_INPUT, Field } from "@/components/field";
import { NavArrowDown } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toSentence } from "@/lib/directs";
import { cn } from "@/lib/utils";

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

/** The people `leaving` names, as not in `parent`. */
const notIn = (parent: string, leaving: string[]) => `${toSentence(leaving)}, who ${leaving.length === 1 ? "isn’t" : "aren’t"} in ${parent}`;

/** What saving a room under `parent` would take from the people `leaving` names, as the form says it. */
export const leavingWarning = (parent: string, leaving: string[]) => `Moving this room under ${parent} removes ${notIn(parent, leaving)}.`;

/** The same, as the confirmation titled with the move says it. */
export const leavingLine = (parent: string, leaving: string[]) => `This removes ${notIn(parent, leaving)}.`;

/** The value the radio group gives None, a room of its own. */
const NONE = "";

const NONE_LABEL = "None (a room of its own)";

/** A room's icon in the field and its menu. */
const ICON = "w-[18px] shrink-0 text-center text-[20px] leading-none text-muted-foreground";

/**
 * The room forms' Parent room, a field the height of the others that opens a menu: None, for a room of
 * its own, then the rooms it could go under, with their icons. Below it, what going under one means, and
 * a warning naming whoever the room would lose, not being in the parent picked.
 */
export function ParentPicker({ value, choices, onChange, locked, leaving = [], disabled }: ParentField & { disabled: boolean }) {
  const hintId = useId();
  const warningId = useId();
  const parent = parentChoice(choices, value);
  return (
    <div className="mt-[22px]">
      <Field id="room_parent" label="Parent room">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            id="room_parent"
            disabled={disabled || locked !== undefined}
            aria-describedby={cn(hintId, leaving.length > 0 && parent && warningId)}
            className={cn(
              "flex w-full min-w-0 cursor-pointer items-center gap-2.5 border text-start disabled:cursor-not-allowed disabled:opacity-50",
              FIELD_INPUT,
            )}
          >
            {parent && <RoomIcon icon={parent.icon} closed={!parent.everyone} size={18} className={ICON} />}
            <span className="min-w-0 flex-1 truncate">{parent?.name ?? NONE_LABEL}</span>
            <NavArrowDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          {/* Short enough to open below the field, where it has the room, rather than over the page above it, scrolling
              through the rest. */}
          <DropdownMenuContent
            align="start"
            collisionPadding={8}
            className="max-h-[min(var(--radix-dropdown-menu-content-available-height),20rem)] w-(--radix-dropdown-menu-trigger-width)"
          >
            <DropdownMenuRadioGroup value={value ?? NONE} onValueChange={(picked) => onChange(picked || null)}>
              <DropdownMenuRadioItem value={NONE} className="text-base">
                {/* Where the rooms have their icons, so every name starts in line. */}
                <span aria-hidden="true" className="w-[18px] shrink-0" />
                {NONE_LABEL}
              </DropdownMenuRadioItem>
              {choices.map((choice) => (
                <DropdownMenuRadioItem key={choice.id} value={choice.id} className="text-base">
                  <RoomIcon icon={choice.icon} closed={!choice.everyone} size={18} className={ICON} />
                  <span className="min-w-0 truncate">{choice.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Field>
      <p id={hintId} className="mt-2 text-xs text-muted-foreground">
        {locked ?? "Only the parent’s people can be in a sub-room."}
      </p>
      {leaving.length > 0 && parent && (
        <p id={warningId} role="status" className="mt-2 text-xs text-negative wrap-anywhere">
          {leavingWarning(parent.name, leaving)}
        </p>
      )}
    </div>
  );
}
