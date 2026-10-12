import type { User } from "@ember/protocol";
import { avatarColor, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/** Generated initials avatar. Messages use squares with ember-rust's 6px corners (zz-ember.css, `.message__avatar`); the rail and presence use circles. */
export function UserAvatar({ user, className, square = false }: { user: User; className?: string; square?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 select-none items-center justify-center overflow-hidden font-extrabold tracking-tight text-white",
        square ? "rounded-[6px]" : "rounded-full",
        className,
      )}
      style={{ backgroundColor: avatarColor(user.id), containerType: "inline-size" }}
    >
      <span style={{ fontSize: "45cqi" }}>{initials(user.name)}</span>
    </span>
  );
}
