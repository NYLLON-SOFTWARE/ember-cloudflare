import { feature } from "@ember/parity";
import type { WebSocketRoute } from "@playwright/test";
import { ROOM_SOCKET } from "../../fixtures";
import { expect, test, type Members } from "./fixtures";

test.describe(feature("realtime.who-is-here"), () => {
  test("shows who is in the room as people come and go", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(ada.presence()).toHaveText("1 here now");

    const grace = await members.signIn("Grace");
    await expect(ada.presence()).toHaveText("2 here now");
    await expect(grace.presence()).toHaveText("2 here now");
    await expect(ada.page.getByTitle(/^(Ada, Grace|Grace, Ada)$/)).toBeVisible();

    await grace.page.close();
    await expect(ada.presence()).toHaveText("1 here now");
  });
});

test.describe(feature("realtime.presence"), () => {
  test("counts someone with two tabs open once", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const secondTab = await grace.page.context().newPage();
    await secondTab.goto(`/rooms/${rooms.general.id}`);
    await expect(secondTab.getByText("2 here now")).toBeAttached();

    await secondTab.close();
    await expect(ada.presence()).toHaveText("2 here now");
  });
});

test.describe(feature("realtime.typing"), () => {
  test("shows who is typing until they send or clear their message", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");

    await grace.composer().fill("Let me think");
    await expect(ada.typingIndicator()).toHaveText("Grace");
    await expect(ada.typingIndicator()).toBeVisible();
    await expect(grace.typingIndicator()).toHaveText("");

    await grace.composer().fill("");
    await expect(ada.typingIndicator()).toHaveText("");
    await expect(ada.typingIndicator()).toBeHidden();

    // Typing goes out at most once a second, even after a stop, so Grace shows again as she types on.
    await grace.composer().pressSequentially("Here's my answer", { delay: 100 });
    await expect(ada.typingIndicator()).toHaveText("Grace");
    await grace.composer().press("Enter");
    await expect(ada.typingIndicator()).toHaveText("");
  });

  test("names everyone typing, sorted and comma-separated", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const linus = await members.signIn("Linus");
    const ken = await members.signIn("Ken");

    await linus.composer().fill("…");
    await grace.composer().fill("…");
    await expect(ada.typingIndicator()).toHaveText("Grace, Linus");
    await ken.composer().fill("…");
    await expect(ada.typingIndicator()).toHaveText("Grace, Ken, Linus");
  });

  test("keeps names that don't fit on one line, clear of the message box", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 320, height: 640 } } });
    for (const name of ["Grace Brewster Murray Hopper", "Kenneth Lane Thompson", "Linus Benedict Torvalds"]) {
      const typist = await members.signIn(name);
      await typist.composer().fill("…");
    }
    await expect(ada.typingIndicator()).toHaveText("Grace Brewster Murray Hopper, Kenneth Lane Thompson, Linus Benedict Torvalds");

    const names = (await ada.typingIndicator().boundingBox())!;
    const field = (await ada.composer().boundingBox())!;
    expect(names.height).toBeLessThan(20);
    expect(names.y + names.height).toBeLessThanOrEqual(field.y);
  });
});

test.describe(feature("realtime.reconnect"), () => {
  /** Routes Ada's room socket so the test can cut it, and keep it cut, like a network drop. */
  async function cuttable(members: Members) {
    let online = true;
    let connection: { page: WebSocketRoute; server: WebSocketRoute } | undefined;
    const ada = await members.signIn("Ada", {
      beforeOpen: (page) =>
        page.routeWebSocket(ROOM_SOCKET, (ws) => {
          if (!online) return ws.close();
          connection = { page: ws, server: ws.connectToServer() };
        }),
    });
    const cut = async () => {
      online = false;
      await connection!.server.close();
      await connection!.page.close();
      // The page knows the connection is down.
      await expect(ada.timeline()).toHaveAttribute("aria-busy", "true");
    };
    const restore = () => {
      online = true;
    };
    return { ada, cut, restore };
  }

  test("reconnects after losing the connection and catches up on what was missed", async ({ members }) => {
    const { ada, cut, restore } = await cuttable(members);
    const grace = await members.signIn("Grace");

    await cut();
    await expect(ada.connection()).toHaveText("Reconnecting…", { timeout: 10_000 });
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeDisabled();
    await ada.composer().fill("Typed while offline");
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeDisabled();

    await grace.send("Sent while Ada was away");
    await expect(grace.message("Sent while Ada was away")).not.toHaveAttribute("aria-busy");

    restore();
    await expect(ada.connection()).toHaveCount(0, { timeout: 20_000 });
    await expect(ada.message("Sent while Ada was away")).toBeVisible();
    await expect(ada.composer()).toHaveValue("Typed while offline");
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("sends a message written during a short drop once the connection is back", async ({ members }) => {
    const { ada, cut, restore } = await cuttable(members);
    const grace = await members.signIn("Grace");

    await cut();
    await ada.send("Written during a short drop");
    await expect(ada.message("Written during a short drop")).toHaveAttribute("aria-busy", "true");
    await expect(ada.page.getByRole("alert")).toHaveCount(0);

    restore();
    await expect(grace.message("Written during a short drop")).toBeVisible();
    await expect(ada.message("Written during a short drop")).not.toHaveAttribute("aria-busy");
    await expect(ada.message("Written during a short drop")).toHaveCount(1);
  });
});
