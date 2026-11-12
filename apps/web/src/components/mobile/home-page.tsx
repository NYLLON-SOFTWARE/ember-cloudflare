import type { ComponentType, ReactNode } from "react";
import type { LiveHuddle, Me, RoomId } from "@ember/protocol";
import { CheckCircle, EditPencil, Group, Headset, MultiBubble, Star } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { useAccount } from "@/hooks/use-account";
import { useDirectoryCount } from "./people-count";
import { roomPath, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { AppearanceMenu } from "../workspace/appearance-menu";
import { NavigationIcon } from "../workspace/navigation-icon";
import { ROUND_BUTTON } from "./back-button";
import { NewMessageButton, TabPage, YouLink } from "./tab-page";
import { DRAFTS_PATH, PEOPLE_PATH, SAVED_PATH, THREADS_PATH, TODOS_PATH } from "./tabs";

interface Props {
  me: Me;
  workspaceName: string;
  /** The conversations, as the sidebar lists them. */
  sidebar: ReactNode;
  /** The huddles going on in this person's rooms, by room. */
  huddles: Record<RoomId, LiveHuddle>;
  /** The release of Ember out since this one, which Admin marks for an administrator, or null for none. */
  newRelease: string | null;
  onNewDirect: (opener: HTMLElement) => void;
}

/**
 * Home on a phone, Slack's: the workspace's logo and name at the top, with the way to its settings, the
 * appearance menu and your avatar at the other end, then a row of cards that scrolls sideways, for what
 * sits above the rooms in the desktop's Home sidebar (Threads, Drafts & sent, People, Saved, To-dos) and
 * the huddles going on, once huddles are on, then the conversations, with New direct message floating
 * over their bottom right.
 */
export function HomePage({ me, workspaceName, sidebar, huddles, newRelease, onNewDirect }: Props) {
  const { logo, tagline, huddles: huddlesOn } = useAccount();
  const live = Object.keys(huddles) as RoomId[];
  const people = useDirectoryCount();
  return (
    <TabPage
      heading={
        <>
          <img src={logo ?? "/ember-icon.png"} alt="" width={36} height={36} className="size-9 shrink-0 rounded-[9px] object-cover" />
          <hgroup className="min-w-0">
            <h1 className="truncate text-[19px] leading-6 font-bold">{workspaceName}</h1>
            {tagline && <p className="truncate text-xs leading-4 text-muted-foreground">{tagline}</p>}
          </hgroup>
        </>
      }
      actions={
        <>
          <PageLink
            href={WORKSPACE_SETTINGS_PATH}
            aria-label={me.administrator ? "Admin" : "Workspace"}
            title={me.administrator ? "Admin" : "Workspace"}
            aria-description={newRelease === null ? undefined : `Ember ${newRelease} is available`}
            className={`relative ${ROUND_BUTTON}`}
          >
            <NavigationIcon slot="admin" size={20} className="size-5" />
            {newRelease !== null && <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-[9px] rounded-full border-2 border-surface bg-foreground" />}
          </PageLink>
          {/* Below the top bar, clear of its other buttons. */}
          <AppearanceMenu side="bottom" />
          <YouLink me={me} />
        </>
      }
      floating={<NewMessageButton onNewDirect={onNewDirect} />}
    >
      <ul aria-label="Shortcuts" className="flex shrink-0 gap-2.5 overflow-x-auto border-b px-4 py-3 [scrollbar-width:none]">
        <Card Icon={MultiBubble} title="Threads" detail="Following" href={THREADS_PATH} />
        <Card Icon={EditPencil} title="Drafts & sent" detail="Unsent" href={DRAFTS_PATH} />
        <Card Icon={Group} title="People" detail={people === null ? "Directory" : `${people} ${people === 1 ? "person" : "people"}`} href={PEOPLE_PATH} />
        <Card Icon={Star} title="Saved" detail="For later" href={SAVED_PATH} />
        <Card Icon={CheckCircle} title="To-dos" detail="Your list" href={TODOS_PATH} />
        {huddlesOn && (
          <Card Icon={Headset} title="Huddles" detail={`${live.length} live`} href={live.length > 0 ? roomPath(live[0]!) : undefined} marked={live.length > 0} />
        )}
      </ul>
      {/* The conversations keep their own scrolling, which moving a starred room scrolls as it's dragged,
          in the room left under the cards. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">{sidebar}</div>
    </TabPage>
  );
}

interface CardProps {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  /** Where it goes, or nowhere, when there's nothing there. */
  href?: string;
  /** Whether something's waiting there, which a dot marks. */
  marked?: boolean;
}

/** One of Home's cards: an icon with a dot when something's waiting there, its name, and how much. */
function Card({ Icon, title, detail, href, marked = false }: CardProps) {
  const contents = (
    <>
      <span className="relative w-fit">
        <Icon className="size-6" />
        {marked && <span aria-hidden="true" className="absolute -top-0.5 -right-1 size-2 rounded-full bg-foreground" />}
      </span>
      <span className="mt-1 text-base leading-5 font-semibold">{title}</span>
      <span className="text-sm leading-5 text-muted-foreground">{detail}</span>
    </>
  );
  const card = "flex min-h-[92px] w-[132px] flex-col rounded-xl border bg-surface px-3.5 py-3 text-foreground no-underline";
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
