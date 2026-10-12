import type { User } from "@ember/protocol";
import { avatarColor, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/** Generated initials avatar. Messages use rounded squares, the rail and presence use circles. */
export function UserAvatar({ user, className, square = false }: { user: User; className?: string; square?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 select-none items-center justify-center overflow-hidden font-extrabold tracking-tight text-white",
        square ? "rounded-md" : "rounded-full",
        className,
      )}
      style={{ backgroundColor: avatarColor(user.id), containerType: "inline-size" }}
    >
      <span style={{ fontSize: "45cqi" }}>{initials(user.name)}</span>
    </span>
  );
}
