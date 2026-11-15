import type { User } from "@ember/protocol";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

/** How many faces a group DM's avatar shows. */
const MAX_FACES = 4;

interface Props {
  /** Whom the DM is with, but you, or you alone in a DM with yourself. */
  members: User[];
  /**
   * The color behind the avatar, which the front face of a pair is ringed in, so the two read as two:
   * `ring-surface` by default. A row that fills on hover and when it's selected passes its own.
   */
  ringClassName?: string;
}

/**
 * A DM's avatar, 36px square, after Slack's: the other person's face, or for two people, their faces
 * overlapped, the second in front at the bottom right, ringed in the background, or for three or four, a
 * mosaic of their faces filling the square, two to a row.
 */
export function DirectAvatars({ members, ringClassName = "ring-surface" }: Props) {
  if (members.length === 1) return <UserAvatar user={members[0]!} square className="size-9 shrink-0" />;
  if (members.length === 2)
    return (
      <span aria-hidden="true" className="relative size-9 shrink-0">
        <UserAvatar user={members[0]!} square className="absolute top-0 left-0 size-6 rounded-[5px]" />
        <UserAvatar user={members[1]!} square className={cn("absolute right-0 bottom-0 size-6 rounded-[5px] ring-2", ringClassName)} />
      </span>
    );
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 grid-cols-2 grid-rows-2 gap-px">
      {members.slice(0, MAX_FACES).map((member) => (
        <UserAvatar key={member.id} user={member} square className="size-full rounded-[4px]" />
      ))}
    </span>
  );
}
