import type { Me, SkinTone, WorkspaceServerFrame } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDeploy, openWorkspaceSocket, signIn, workspaceSql, type Session } from "./support";

/** Gives `session`'s person the skin tone `skinTone`, as their profile's Skin tone does. */
const choose = (session: Session | null, skinTone: unknown) =>
  api("/api/users/me/skin_tone", { method: "PUT", headers: session ? { Cookie: session.cookie } : {}, body: JSON.stringify({ skinTone }) });

/** Who `GET /api/me` says `session` signs in. */
const meOf = async (session: Session) => ((await (await api("/api/me", { headers: { Cookie: session.cookie } })).json()) as { user: Me }).user;

/** The skin tone stored for `session`'s person. */
const stored = async (session: Session) => ((await workspaceSql("SELECT skin_tone FROM users WHERE id = ?", session.user.id)) as Array<{ skin_tone: number }>)[0]!.skin_tone;

beforeEach(freshDeploy);

describe("Default skin tone", () => {
  it("starts at the emoji's own yellow, which who's signed in leaves out", async () => {
    const ada = await signIn("Ada");
    expect(await meOf(ada)).toEqual({ ...ada.user, administrator: false });
    expect(await stored(ada)).toBe(0);
  });

  it("saves the tone you choose for you alone, which who's signed in then gives, and back to the default", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");

    const response = await choose(ada, 3);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skinTone: 3 });
    expect(await meOf(ada)).toEqual({ ...ada.user, administrator: false, skinTone: 3 });
    expect(await meOf(grace)).toEqual({ ...grace.user, administrator: false });

    expect((await choose(ada, 0)).status).toBe(200);
    expect(await meOf(ada)).toEqual({ ...ada.user, administrator: false });
    expect(await stored(ada)).toBe(0);
  });

  it("tells every tab of yours, and gives a tab that connects later your tone as it welcomes it", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const tabs = [await openWorkspaceSocket(ada), await openWorkspaceSocket(ada)];
    const gracesTab = await openWorkspaceSocket(grace);

    await choose(ada, 5);
    for (const tab of tabs) expect(await tab.next()).toEqual({ type: "skin_tone.changed", skinTone: 5 } satisfies WorkspaceServerFrame);
    expect(await gracesTab.answers()).toBe(true);

    const later = await openWorkspaceSocket(ada);
    expect(later.welcome).toMatchObject({ type: "welcome", you: { ...ada.user, administrator: false, skinTone: 5 as SkinTone } });
  });

  it("refuses a tone that isn't one, changing nothing, and anyone signed out", async () => {
    const ada = await signIn("Ada");
    await choose(ada, 2);

    for (const skinTone of [6, -1, 1.5, "3", null]) {
      const response = await choose(ada, skinTone);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "skinTone must be a whole number from 0 to 5" });
    }
    expect(await stored(ada)).toBe(2);
    expect((await choose(null, 1)).status).toBe(401);
  });
});
