import { describe, expect, it } from "vitest";
import { checkSite, memberfulSiteOf, type Fetch, type RedirectOf } from "./site-check.ts";

/** What an Ember site's `/api/bootstrap` answers, with the account's name and custom domain given. */
const bootstrap = (name: string, customDomain: string | null = null) => ({
  setup: "complete",
  version: "0.4.2",
  account: { name, customDomain },
  user: null,
});

/**
 * A fetch that answers as the sites in `answers` do, by origin, each with a JSON body or a status, as
 * though from `url`, where a redirect took it; any other origin can't be reached.
 */
function sites(answers: Record<string, { body?: unknown; status?: number; url?: string }>): Fetch {
  return async (address) => {
    const url = new URL(address);
    const answer = answers[url.origin];
    if (!answer || url.pathname !== "/api/bootstrap") throw new TypeError("fetch failed");
    const response = new Response(JSON.stringify(answer.body ?? null), { status: answer.status ?? 200, headers: { "Content-Type": "application/json" } });
    Object.defineProperty(response, "url", { value: answer.url ?? url.href });
    return response;
  };
}

describe("checkSite", () => {
  it("finds an Ember site by what it says of itself, and keeps its name", async () => {
    const fetch = sites({ "https://chat.example.com": { body: bootstrap("Fernwood") } });
    expect(await checkSite("https://chat.example.com", fetch)).toEqual({ address: "https://chat.example.com", name: "Fernwood" });
  });

  it("takes one not yet set up, and one too old to know of custom domains", async () => {
    const fetch = sites({
      "https://new.example.com": { body: { ...bootstrap("Ember"), setup: "pending" } },
      "https://old.example.com": { body: { setup: "complete", version: "0.1.0", account: { name: "Old" }, user: null } },
    });
    expect(await checkSite("https://new.example.com", fetch)).toEqual({ address: "https://new.example.com", name: "Ember" });
    expect(await checkSite("https://old.example.com", fetch)).toEqual({ address: "https://old.example.com", name: "Old" });
  });

  it("says when nothing answers, and when what answers isn't Ember", async () => {
    const fetch = sites({
      "https://blog.example.com": { body: { title: "A blog" } },
      "https://gone.example.com": { status: 404, body: { setup: "complete" } },
      "https://html.example.com": { body: "<!doctype html>" },
    });
    expect(await checkSite("https://nowhere.example.com", fetch)).toBe("unreachable");
    for (const address of ["https://blog.example.com", "https://gone.example.com", "https://html.example.com"]) {
      expect(await checkSite(address, fetch)).toBe("not-ember");
    }
  });

  it("opens a site where a redirect took it, as long as that's secure", async () => {
    const fetch = sites({
      "https://example.com": { body: bootstrap("Fernwood"), url: "https://www.example.com/api/bootstrap" },
      "https://downgraded.example.com": { body: bootstrap("Fernwood"), url: "http://downgraded.example.com/api/bootstrap" },
    });
    expect(await checkSite("https://example.com", fetch)).toEqual({ address: "https://www.example.com", name: "Fernwood" });
    expect(await checkSite("https://downgraded.example.com", fetch)).toBe("not-ember");
  });

  it("opens a site at the custom domain it moved to, where its pages go, while that answers", async () => {
    const fetch = sites({
      "https://ember.example.workers.dev": { body: bootstrap("Fernwood", "chat.example.com") },
      "https://chat.example.com": { body: bootstrap("Fernwood", "chat.example.com") },
      "https://stranded.example.workers.dev": { body: bootstrap("Stranded", "unreachable.example.com") },
    });
    expect(await checkSite("https://ember.example.workers.dev", fetch)).toEqual({ address: "https://chat.example.com", name: "Fernwood" });
    expect(await checkSite("https://chat.example.com", fetch)).toEqual({ address: "https://chat.example.com", name: "Fernwood" });
    expect(await checkSite("https://stranded.example.workers.dev", fetch)).toEqual({ address: "https://stranded.example.workers.dev", name: "Stranded" });
  });
});

describe("memberfulSiteOf", () => {
  /** Where each address in `redirects` redirects; any other doesn't, and one at an origin that's down can't be reached. */
  const redirecting =
    (redirects: Record<string, string>, down = "https://down.example.com"): RedirectOf =>
    async (url) => {
      if (new URL(url).origin === down) throw new TypeError("fetch failed");
      return redirects[url] ?? null;
    };

  it("finds the Memberful site where the site sends Sign in with Memberful", async () => {
    const redirectOf = redirecting({ "https://chat.example.com/auth/memberful": "https://fernwood.memberful.com/oauth?response_type=code&client_id=1&state=2" });
    expect(await memberfulSiteOf("https://chat.example.com", redirectOf)).toBe("https://fernwood.memberful.com");
  });

  it("finds none where Sign in with Memberful goes back to sign in, or nowhere, or somewhere insecure, or where the site can't be reached", async () => {
    const redirectOf = redirecting({
      "https://off.example.com/auth/memberful": "https://off.example.com/session/new?memberful=off",
      "https://insecure.example.com/auth/memberful": "http://fernwood.memberful.com/oauth?state=2",
    });
    for (const address of ["https://off.example.com", "https://old.example.com", "https://insecure.example.com", "https://down.example.com"]) {
      expect(await memberfulSiteOf(address, redirectOf)).toBeNull();
    }
  });
});
