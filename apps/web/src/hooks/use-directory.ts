import { createContext, useState } from "react";
import type { DirectoryUser, UserId } from "@ember/protocol";
import { fetchDirectory, type DirectoryCopy } from "@/lib/api";
import { oneAtATime } from "./use-sidebar";

/** Everyone in the workspace by id, as the people directory last listed them. */
export type People = ReadonlyMap<UserId, DirectoryUser>;

/** The people directory, for avatars to find their images in. Empty until it loads. */
export const PeopleContext = createContext<People>(new Map());

/**
 * The people directory, which `reload` loads again, one load at a time, settling once a load asked for
 * since has come. The people stay as they were when it fails or the server says they haven't changed.
 */
export function useDirectory(): { people: People; reload: () => Promise<void> } {
  const [people, setPeople] = useState<People>(() => new Map());
  const [reload] = useState(() => {
    // The last directory the server sent, which it says is still current rather than send again.
    let copy: DirectoryCopy | null = null;
    const load = oneAtATime(async () => {
      const loaded = await fetchDirectory(copy);
      if (loaded === copy) return;
      copy = loaded;
      setPeople(new Map(loaded.directory.users.map((user) => [user.id, user])));
    });
    // A failed load leaves the avatars as they are until the next.
    return () => load().catch(() => {});
  });
  return { people, reload };
}
