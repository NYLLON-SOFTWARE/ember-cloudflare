import type { ComponentType, ReactNode } from "react";
import type { LiveHuddle, Me, RoomId } from "@ember/protocol";
import { EditPencil, Group, Headset, MultiBubble } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { useAccount } from "@/hooks/use-account";
import { roomPath } from "@/hooks/use-route";
import { KEPT_SHORTCUTS, useKeptCounts, type KeptShortcut } from "../workspace/kept-shortcuts";
import { cappedCount, useDraftCount } from "./draft-count";
import { useDirectoryCount } from "./people-count";
import { NewMessageButton, TabPage, YouLink } from "./tab-page";
import { DRAFTS_PATH, PEOPLE_PATH, THREADS_PATH } from "./tabs";
import { NewReleaseContext } from "./you-sheet";

interface Props {
  me: Me;
  workspaceName: string;
  /** The conversations, as the sidebar lists them. */
  sidebar: ReactNode;
  /** The huddles going on in this person's rooms, by room. */
  huddles: Record<RoomId, LiveHuddle>;
  /** The release of Ember out since this one, which the You sheet's Admin says is available, or null for none. */
  newRelease: string | null;
  onNewDirect: (opener: HTMLElement) => void;
}

/**
 * Home on a phone, Slack's: the workspace's logo and name at the top, with your avatar, which opens the
 * You sheet, at the other end, then a row of cards that scrolls sideways, for what sits above the rooms in
 * the desktop's Home sidebar (Threads, Drafts & sent, People, Saved, To-dos) and the huddles going on,
 * once huddles are on, then the conversations, with New direct message floating over their bottom right.
 * The logo, the cards and the rooms' icons line up 16px from the screen's edge.
 */
export function HomePage({ me, workspaceName, sidebar, huddles, newRelease, onNewDirect }: Props) {
  const { logo, huddles: huddlesOn } = useAccount();
  const live = Object.keys(huddles) as RoomId[];
  const people = useDirectoryCount();
  const drafts = useDraftCount(me.id);
  return (
    <NewReleaseContext value={newRelease}>
      <TabPage
        heading={
          <>
            <img src={logo ?? "/ember-icon.png"} alt="" width={36} height={36} className="size-9 shrink-0 rounded-[9px] object-cover" />
            <h1 className="min-w-0 truncate text-[19px] leading-6 font-bold">{workspaceName}</h1>
          </>
        }
        actions={<YouLink me={me} />}
        floating={<NewMessageButton onNewDirect={onNewDirect} />}
      >
        <ul aria-label="Shortcuts" className="flex shrink-0 gap-2.5 overflow-x-auto border-b px-4 py-3 [scrollbar-width:none]">
          <Card Icon={MultiBubble} title="Threads" href={THREADS_PATH} />
          <Card Icon={EditPencil} title="Drafts & sent" detail={drafts > 0 ? `${cappedCount(drafts)} ${drafts === 1 ? "draft" : "drafts"}` : undefined} href={DRAFTS_PATH} />
          <Card Icon={Group} title="People" detail={people === null ? undefined : `${people} ${people === 1 ? "person" : "people"}`} href={PEOPLE_PATH} />
          {KEPT_CARDS.map((page) => (
            <KeptCard key={page} shortcut={KEPT_SHORTCUTS.find((shortcut) => shortcut.page === page)!} />
          ))}
          {huddlesOn && <Card Icon={Headset} title="Huddles" detail={live.length > 0 ? `${live.length} live` : undefined} href={live.length > 0 ? roomPath(live[0]!) : undefined} />}
        </ul>
        {/* The conversations keep their own scrolling, which moving a starred room scrolls as it's dragged,
            in the room left under the cards. They scroll on behind the tab bar and New direct message,
            and clear of them at their end, past a spacer rather than padding, which a list can't be shorter
            than, as on a phone on its side; less the 16px gap before it. Their rows' icons line up with the cards. */}
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] *:px-[7px]! *:pb-0! *:after:h-[calc(var(--mobile-bottom-inset,6rem)-1rem)] *:after:shrink-0">
          {sidebar}
        </div>
      </TabPage>
    </NewReleaseContext>
  );
}

interface CardProps {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  /** How much is there, when there's a count to give. */
  detail?: ReactNode;
  /** Where it goes, or nowhere, when there's nothing there. */
  href?: string;
}

/** Saved, then To-dos, as the desktop's Home sidebar has them. */
const KEPT_CARDS: KeptShortcut["page"][] = ["saved", "todos"];

/**
 * Saved's or To-dos' card, which says their counts once there are any: none, or not loaded yet, says
 * nothing. To-dos' says how many are overdue alone, in red, when any are, which is what a narrow card has
 * room for and what matters most, or else how many are open.
 */
function KeptCard({ shortcut }: { shortcut: KeptShortcut }) {
  const counts = useKeptCounts();
  const count = shortcut.page === "todos" ? counts.openTodos : counts.savedItems;
  const parts = shortcut.detail(counts);
  const part = parts.find((part) => part.alert) ?? parts[0];
  const detail = count > 0 && part ? <span className={part.alert ? "text-negative" : undefined}>{part.text}</span> : undefined;
  return <Card Icon={shortcut.Icon} title={shortcut.title} detail={detail} href={shortcut.href} />;
}

/** One of Home's cards: an icon, its name, and how much is there, each the same height with a count or without. */
function Card({ Icon, title, detail, href }: CardProps) {
  const contents = (
    <>
      <Icon className="size-6" />
      <span className="mt-1 truncate text-base leading-5 font-semibold">{title}</span>
      {detail && <span className="text-sm leading-5 whitespace-nowrap text-muted-foreground">{detail}</span>}
    </>
  );
  const card = "flex h-full min-h-[92px] w-max min-w-[132px] flex-col rounded-xl border bg-surface px-3.5 py-3 text-foreground no-underline";
  return (
    <li className="shrink-0">
      {href ? (
        <PageLink href={href} className={`${card} hover:bg-hover`}>
          {contents}
        </PageLink>
      ) : (
        <div className={`${card} text-muted-foreground`}>{contents}</div>
      )}
    </li>
  );
}
