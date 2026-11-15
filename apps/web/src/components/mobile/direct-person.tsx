import type { Room, User, UserId } from "@ember/protocol";
import { membersShown } from "@/lib/directs";
import { cn } from "@/lib/utils";
import { UserAvatar } from "../workspace/user-avatar";

/** The one person a DM is with, or you in your DM with yourself; null for a group DM, or a room. */
export function personOfDirect(room: Room, meId: UserId): User | null {
  if (room.kind !== "direct") return null;
  const shown = membersShown(room, meId);
  return shown.length === 1 ? shown[0]! : null;
}

interface Props {
  person: User;
  /** Whether they're here now, which a green dot says, as the members list marks them. */
  here: boolean;
  /** Its size, and the dot's edge, the color of what it's on. */
  className?: string;
  edge?: string;
}

/** The avatar of the person a DM is with, in a room's top bar in place of the room's icon. */
export function DirectAvatar({ person, here, className, edge = "border-background" }: Props) {
  return (
    <span className={cn("relative flex shrink-0", className)}>
      <UserAvatar user={person} className="size-full" />
      {here && <span aria-hidden="true" className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 bg-positive", edge)} />}
    </span>
  );
}
