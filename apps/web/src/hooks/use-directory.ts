import { createContext, useState } from "react";
import type { DirectoryUser, UserId } from "@ember/protocol";
import { fetchDirectory, type DirectoryCopy } from "@/lib/api";
import { oneAtATime } from "./use-sidebar";

/** Everyone in the workspace by id, as the people directory last listed them. */
export type People = ReadonlyMap<UserId, DirectoryUser>;

/** The people directory, for avatars to find their images in. Empty until it loads. */
export const PeopleContext = createContext<People>(new Map());

/** `people` with each of `changed` as they are now. */
function withChanges(people: People, changed: DirectoryUser[]): People {
  const next = new Map(people);
  for (const user of changed) next.set(user.id, user);
  return next;
}

/**
 * The people directory, which `reload` loads again, one load at a time, settling once a load asked for
 * since has come or failed, and `update` changes someone in, as the workspace socket or a change made
 * here says they are now. The people stay as they were when a load fails or the server says they
 * haven't changed.
 */
export function useDirectory(): { people: People; reload: () => Promise<void>; update: (user: DirectoryUser) => void } {
  const [people, setPeople] = useState<People>(() => new Map());
  const [directory] = useState(() => {
    // The last directory the server sent, which it says is still current rather than send again.
    let copy: DirectoryCopy | null = null;
    // Who changed while a load was on its way, which may have read them before they did.
    let changedSince: DirectoryUser[] | null = null;
    const load = oneAtATime(async () => {
      const changed: DirectoryUser[] = (changedSince = []);
      try {
        const loaded = await fetchDirectory(copy);
        if (loaded === copy) return;
        copy = loaded;
        setPeople(withChanges(new Map(loaded.directory.users.map((user) => [user.id, user])), changed));
      } finally {
        changedSince = null;
      }
    });
    const update = (user: DirectoryUser) => {
      changedSince?.push(user);
      setPeople((people) => withChanges(people, [user]));
    };
    return { reload: load, update };
  });
  return { people, ...directory };
}
