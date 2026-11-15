import type { ReactNode } from "react";
import type { Person } from "@ember/protocol";
import { Prohibition } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { cn } from "@/lib/utils";
import { PageHeader } from "../workspace/page-header";
import { UserAvatar } from "../workspace/user-avatar";
import { BackButton } from "./back-button";

interface Props {
  /** Where Back goes when the app didn't open the page. */
  back: string;
  /** Who it's for, or null while they load. */
  person: Person | null;
  /** What the top bar ends with, such as Edit my profile on your own. */
  links?: ReactNode;
  /** Their name and what else the page says of them, under their picture. */
  children: ReactNode;
}

/**
 * Someone's profile on a phone, Slack's: Back and "Profile" at the top, their picture the width of the
 * screen, dimmed under a cancel mark while they're banned, and under it, from the left, their name and
 * what else their page says, with Message.
 */
export function PhoneProfile({ back, person, links, children }: Props) {
  const banned = person?.status === "banned";
  return (
    <>
      <PageHeader>
        <BackButton fallback={back} />
        <p className="min-w-0 flex-1 truncate text-center text-[17px] leading-6 font-bold">Profile</p>
        {/* As wide as Back, so Profile stays in the middle. */}
        <div className="flex min-w-11 shrink-0 justify-end">{links}</div>
      </PageHeader>
      <MainContent
        aria-busy={person === null}
        className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-background pr-[env(safe-area-inset-right)] pb-6 pl-[env(safe-area-inset-left)]"
      >
        {person && (
          <div className="mx-auto max-w-[480px] px-4 pt-4">
            <div className="relative">
              <UserAvatar user={person} label="Profile avatar" square className={cn("aspect-square h-auto w-full rounded-2xl", banned && "opacity-50")} />
              {banned && <Prohibition className="absolute inset-0 m-auto size-1/2" />}
            </div>
            <div className="mt-4 text-start wrap-anywhere [&_h1]:text-[26px]">{children}</div>
          </div>
        )}
      </MainContent>
    </>
  );
}
