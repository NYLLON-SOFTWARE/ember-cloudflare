import { useContext, useDeferredValue, useMemo, useState } from "react";
import type { DirectoryUser } from "@ember/protocol";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { DirectoryLoaded, PeopleContext } from "@/hooks/use-directory";
import { personPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { byName } from "@/lib/people";
import { PageHeader } from "./page-header";
import { SearchField } from "./search-field";
import { UserAvatar } from "./user-avatar";

/** Whether someone is shown in the directory: a person, not a bot, who hasn't left or been banned. */
const isListed = (person: DirectoryUser) => person.status === "active" && person.role !== "bot";

/** Whether `person`'s name or bio has `sought`, whatever its case. */
export function personMatches(person: Pick<DirectoryUser, "name" | "bio">, sought: string): boolean {
  const folded = sought.trim().toLocaleLowerCase();
  return folded === "" || person.name.toLocaleLowerCase().includes(folded) || (person.bio ?? "").toLocaleLowerCase().includes(folded);
}

/**
 * The People page, at `/people`, after Slack's directory: a search box, and a card for each person in the
 * workspace, by name, with their photo, name and bio, which opens their page. Typing in the box shows
 * only the people whose name or bio has what's typed.
 */
export function PeoplePage() {
  const people = useContext(PeopleContext);
  const loaded = useContext(DirectoryLoaded);
  const [typed, setTyped] = useState("");
  const sought = useDeferredValue(typed);
  const listed = useMemo(() => byName([...people.values()].filter(isListed)), [people]);
  const shown = useMemo(() => listed.filter((person) => personMatches(person, sought)), [listed, sought]);
  useTitle("People");
  return (
    <>
      <PageHeader back="/">
        <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-center max-md:font-bold">People</h1>
        {/* As wide as Back, so the title stays in the middle on a phone. */}
        <span aria-hidden="true" className="hidden w-11 shrink-0 max-md:block" />
      </PageHeader>
      <MainContent className="min-h-0 min-w-0 overflow-y-auto bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-[22px] pt-5 pb-[max(22px,env(safe-area-inset-bottom))] max-md:px-3">
          <SearchField value={typed} onChange={setTyped} placeholder="Search for people" label="Search for people" />
          {shown.length > 0 ? (
            <ul aria-label="People" className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4 max-md:-mx-3 max-md:flex max-md:flex-col max-md:gap-0">
              {shown.map((person) => (
                <li key={person.id}>
                  <PersonCard person={person} />
                </li>
              ))}
            </ul>
          ) : (
            loaded && <p className="py-10 text-center text-muted-foreground">{listed.length === 0 ? "Nobody’s here yet." : "No one matches that search."}</p>
          )}
        </div>
      </MainContent>
    </>
  );
}

/**
 * Someone's card: their photo, filling the card's width, over their name and bio, the whole card a link to
 * their page. On phones it's a row, as Slack's app lists people: a 40px photo beside their name and a line
 * of their bio.
 */
function PersonCard({ person }: { person: DirectoryUser }) {
  return (
    <PageLink
      href={personPath(person.id)}
      className="group flex h-full flex-col overflow-hidden rounded-xl border bg-surface text-foreground no-underline hover:bg-hover max-md:min-h-14 max-md:flex-row max-md:items-center max-md:gap-3 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:py-2"
    >
      <UserAvatar user={person} lazy square className="aspect-square h-auto w-full rounded-none max-md:size-10 max-md:shrink-0 max-md:rounded-[6px]" />
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5 max-md:flex-1 max-md:p-0">
        <span className="truncate text-[15px] font-semibold max-md:text-[17px]">{person.name}</span>
        {person.bio?.trim() && <span className="line-clamp-2 text-[13px] text-muted-foreground max-md:line-clamp-1 max-md:text-[14px]">{person.bio}</span>}
      </span>
    </PageLink>
  );
}
