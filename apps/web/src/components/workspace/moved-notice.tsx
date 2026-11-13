import { useState } from "react";
import { useAccount } from "@/hooks/use-account";
import { useVisit } from "@/hooks/use-route";
import { staysAtAnyAddress, thisPageAt } from "@/lib/custom-domain";
import { RarePage } from "./rare-pages";

// A tab left open at another address as Ember is given a custom domain, which a page opened afresh would
// move to, says so, with a link to the page it shows there. It sits where the workspace's flashes do,
// under them.

/** Says Ember has moved to its custom domain, until it's closed, on any page that would move there. */
export function MovedNotice() {
  const { customDomain } = useAccount();
  // Each page has its own address there.
  useVisit();
  // The custom domain it was closed for, which a new one shows it again for.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const there = thisPageAt(customDomain);
  if (there === null || staysAtAnyAddress(location.pathname) || closedFor === customDomain) return null;
  return <RarePage show={({ MovedBanner }) => <MovedBanner customDomain={customDomain} there={there} onClose={() => setClosedFor(customDomain)} />} loading={null} />;
}
