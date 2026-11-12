import { useContext } from "react";
import { DirectoryLoaded, PeopleContext } from "@/hooks/use-directory";

/** How many people are active in the workspace, bots aside, as the people directory lists them, or null until it's loaded. */
export function useDirectoryCount(): number | null {
  const people = useContext(PeopleContext);
  const loaded = useContext(DirectoryLoaded);
  if (!loaded) return null;
  let count = 0;
  for (const person of people.values()) if (person.status === "active" && person.role !== "bot") count++;
  return count;
}
