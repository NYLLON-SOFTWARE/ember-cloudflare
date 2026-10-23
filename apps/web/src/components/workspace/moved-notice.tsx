import { useState } from "react";
import { Close } from "@/components/icons/ember";
import { useAccount } from "@/hooks/use-account";
import { useVisit } from "@/hooks/use-route";
import { staysAtAnyAddress, thisPageAt } from "@/lib/custom-domain";

// This port's own (`accounts.custom-domain`): a tab left open at another address as Ember is given a custom
// domain, which a page opened afresh would move to, says so, with a link to the page it shows there. It sits
// where the workspace's flashes do, under them.

/** Says Ember has moved to its custom domain, until it's closed, on any page that would move there. */
export function MovedNotice() {
  const { customDomain } = useAccount();
  // Each page has its own address there.
  useVisit();
  // The custom domain it was closed for, which a new one shows it again for.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const there = thisPageAt(customDomain);
  if (there === null || staysAtAnyAddress(location.pathname) || closedFor === customDomain) return null;
  return (
    <div className="fixed top-[calc(var(--spacing-header)+12px)] left-1/2 z-20 flex w-max max-w-[calc(100dvw-24px)] -translate-x-1/2 max-md:top-[calc(56px+env(safe-area-inset-top)+12px)] md:left-[calc((100%+env(safe-area-inset-left)+var(--spacing-rail)+var(--spacing-sidebar))/2)] md:max-w-[calc(100dvw-env(safe-area-inset-left)-var(--spacing-rail)-var(--spacing-sidebar)-24px)]">
      <div role="status" className="flex items-center gap-3 rounded-[10px] border bg-background py-1 ps-4 pe-1 shadow-[0_8px_24px_#00000012]">
        <p className="min-w-0">
          Ember has moved to <strong className="wrap-anywhere">{customDomain}</strong>.{" "}
          <a href={there} className="font-medium whitespace-nowrap underline">
            Go there
          </a>
        </p>
        <button type="button" aria-label="Close" onClick={() => setClosedFor(customDomain)} className="flex size-11 flex-none items-center justify-center rounded-lg hover:bg-hover">
          <Close className="size-5" />
        </button>
      </div>
    </div>
  );
}
