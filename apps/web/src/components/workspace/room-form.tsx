import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { MAX_ROOM_NAME_LENGTH, type User } from "@ember/protocol";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Check, Everyone } from "@/components/icons/campfire";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

// ember-rust's room forms, which New room and a room's settings share (rooms/layouts/_form.html, with
// rooms/opens/_form.html or rooms/closeds/_form.html in its `.room-access` box): the room's name, who
// it's for, and Save.

/** How many people a form lists before it gets a filter, as ember-rust's do. */
const FILTER_ABOVE = 20;
/** How long the filter waits for typing to stop, as Campfire's filter_controller.js does. */
const FILTER_DELAY_MS = 300;

interface Props<Person extends User> {
  /** Whether this person can change the room. Others see its name as a heading, and no Save. */
  canAdminister: boolean;
  name: string;
  onNameChange: (name: string) => void;
  /** The Everyone row, on for a room open to everyone, with a switch if `onFlip` is given; null for none. */
  everyone: { on: boolean; onFlip?: () => void } | null;
  /** The people listed, by name, in groups a line divides, such as a private room's members and everyone else. */
  groups: Person[][];
  /** What follows someone's name: a check mark, a switch, or nothing. */
  mark: (person: Person) => ReactNode;
  saving: boolean;
  onSave: () => void;
}

export function RoomForm<Person extends User>({ canAdminister, name, onNameChange, everyone, groups, mark, saving, onSave }: Props<Person>) {
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  return (
    <form onSubmit={save}>
      {canAdminister ? (
        <Field id="room_name" label="Room name">
          <Input
            id="room_name"
            required
            autoFocus
            maxLength={MAX_ROOM_NAME_LENGTH}
            placeholder="Name the room"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className={FIELD_INPUT}
          />
        </Field>
      ) : (
        <h2 className="text-[24px] font-bold wrap-anywhere max-md:text-[22px]">{name}</h2>
      )}

      <section className="my-4 rounded-[10px] border bg-surface px-[1ch]">
        <People everyone={everyone} groups={groups} mark={mark} />
      </section>

      {canAdminister && <SubmitButton disabled={saving}>Save</SubmitButton>}
    </form>
  );
}

/** ember-rust's `user_filter_menu_tag`: the Everyone row, then a filter for a long list, then the people. */
function People<Person extends User>({ everyone, groups, mark }: Pick<Props<Person>, "everyone" | "groups" | "mark">) {
  const [filter, setFilter] = useState("");
  const listed = groups.filter((group) => group.length > 0);
  const count = listed.reduce((sum, group) => sum + group.length, 0);
  const shown = (person: Person) => person.name.toLowerCase().includes(filter);

  return (
    <menu className="m-0 flex max-h-[50vh] flex-col gap-x-[1ch] gap-y-4 overflow-y-auto px-[1ch] py-4">
      {everyone && (
        <>
          <Row figure={<Everyone className="size-[4ch] shrink-0" />} name="Everyone">
            {everyone.onFlip && (
              <Switch
                checked={everyone.on}
                onCheckedChange={everyone.onFlip}
                aria-label={everyone.on ? "Give only some access to this room" : "Give everyone access to this room"}
              />
            )}
          </Row>
          <Separator />
        </>
      )}

      {count > FILTER_ABOVE && <Filter onFilter={setFilter} />}

      {listed.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <Separator />}
          {group.filter(shown).map((person) => (
            <Row key={person.id} figure={<UserAvatar user={person} className="size-[4ch]" />} name={person.name}>
              {mark(person)}
            </Row>
          ))}
        </Fragment>
      ))}
    </menu>
  );
}

/** One row of the list: a picture, the name in a pill, a dashed line, and what follows. */
function Row({ figure, name, children }: { figure: ReactNode; name: string; children?: ReactNode }) {
  return (
    <li className="flex items-center gap-x-[1ch]">
      {figure}
      <div className="min-w-0">
        <div className="truncate rounded-full border bg-surface px-[9px] py-[3px] leading-[1.4]">
          <strong>{name}</strong>
        </div>
      </div>
      <hr aria-hidden="true" className="min-w-[2ch] grow border-t border-dashed" />
      {children}
    </li>
  );
}

/** Campfire's `.separator.full-width` with `--border-style: solid`. */
function Separator() {
  return <hr className="w-full" />;
}

/**
 * ember-rust's `user_filter_search_tag`: narrows the list to the names holding what's typed, once
 * typing stops. Enter here doesn't save the form, as it would in ember-rust's.
 */
function Filter({ onFilter }: { onFilter: (filter: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const filter = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value.toLowerCase();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onFilter(text), FILTER_DELAY_MS);
  };

  return (
    <Input
      type="search"
      autoCorrect="off"
      autoComplete="off"
      data-1p-ignore
      placeholder="Filter…"
      onChange={filter}
      onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
      className={cn(FIELD_INPUT, "bg-transparent px-[0.8em] py-[0.5em]")}
    />
  );
}

/** ember-rust's check mark, for someone a room takes in who has no switch. */
export function CheckMark() {
  return <Check width={20} height={20} className="size-5 shrink-0" />;
}

/** The switch that gives someone access to a private room. */
export function AccessSwitch({ person, checked, onCheckedChange }: { person: User; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={`Give ${person.name} access to this room`} />;
}
