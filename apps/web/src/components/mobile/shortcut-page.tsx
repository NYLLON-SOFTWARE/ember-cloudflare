import { MainContent } from "@/components/main-content";
import { PageHeader } from "../workspace/page-header";
import { BackButton } from "./back-button";
import { EmptyList } from "./tab-page";

/**
 * One of Home's cards' pages on a phone, Threads, Drafts & sent, People, Saved or To-dos, before this
 * copy of Ember has it: Back to Home and its name, over the whole screen, and that there's nothing yet.
 */
export function ShortcutPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader>
        <BackButton fallback="/" />
        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] leading-6 font-bold">{title}</h1>
        {/* As wide as Back, so the title stays in the middle. */}
        <span className="w-11 shrink-0" />
      </PageHeader>
      <MainContent className="min-h-0 min-w-0 overflow-y-auto bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <EmptyList>Nothing here yet.</EmptyList>
      </MainContent>
    </>
  );
}
