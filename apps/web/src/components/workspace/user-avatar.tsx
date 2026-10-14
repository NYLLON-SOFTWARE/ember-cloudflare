import { useContext, useState } from "react";
import { avatarSvg, type User } from "@ember/protocol";
import { PeopleContext } from "@/hooks/use-directory";
import { cn } from "@/lib/utils";

/** Avatars drawn in the page, by id and name, since a timeline shows the same people again and again. */
const drawings = new Map<string, string>();

/** Someone's initials avatar as the Worker draws it, as an image's address. The SVG is all ASCII, as `btoa` needs. */
function drawn({ id, name }: User): string {
  const key = `${id}\n${name}`;
  let url = drawings.get(key);
  if (url === undefined) drawings.set(key, (url = `data:image/svg+xml;base64,${btoa(avatarSvg(id, name))}`));
  return url;
}

interface Props {
  user: User;
  className?: string;
  square?: boolean;
  /** Whether the image waits until it's scrolled near, as ember-rust's people lists' do. */
  lazy?: boolean;
}

/**
 * Someone's avatar, the image the people directory gives the address of, hidden from screen readers as
 * ember-rust's are (helpers/users.rs, `avatar_tag`). Until it loads, or if it can't, or the directory
 * doesn't list them yet, their initials show as the Worker would draw them. Messages use squares with
 * ember-rust's 6px corners (zz-ember.css, `.message__avatar`); the rail and presence use circles.
 */
export function UserAvatar({ user, className, square = false, lazy = false }: Props) {
  const served = useContext(PeopleContext).get(user.id)?.avatarUrl;
  const [failed, setFailed] = useState<string | null>(null);
  const placeholder = drawn(user);
  return (
    <img
      src={served && served !== failed ? served : placeholder}
      alt=""
      aria-hidden="true"
      loading={lazy ? "lazy" : undefined}
      onError={() => served && setFailed(served)}
      className={cn("inline-block size-9 shrink-0 select-none bg-cover", square ? "rounded-[6px]" : "rounded-full", className)}
      style={{ backgroundImage: `url("${placeholder}")` }}
    />
  );
}
