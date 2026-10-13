import { feature } from "@ember/parity";
import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures";

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
    await expect(ada.typingIndicator()).toHaveText("Grace is typing…");
    await expect(grace.typingIndicator()).toHaveText("");

    await grace.composer().fill("");
    await expect(ada.typingIndicator()).toHaveText("");

    await grace.composer().fill("Here's my answer");
    await expect(ada.typingIndicator()).toHaveText("Grace is typing…");
    await grace.composer().press("Enter");
    await expect(ada.typingIndicator()).toHaveText("");
  });

  test("names two typists, then summarizes more", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const linus = await members.signIn("Linus");
    const ken = await members.signIn("Ken");

    await grace.composer().fill("…");
    await linus.composer().fill("…");
    await expect(ada.typingIndicator()).toHaveText(/^(Grace and Linus|Linus and Grace) are typing…$/);
    await ken.composer().fill("…");
    await expect(ada.typingIndicator()).toHaveText("Several people are typing…");
  });
});

test.describe(feature("realtime.reconnect"), () => {
  test("reconnects after losing the connection and catches up on what was missed", async ({ members }) => {
    // Route Ada's room socket so the test can cut it, and keep it cut, like a network drop.
    let online = true;
    let connection: { page: WebSocketRoute; server: WebSocketRoute } | undefined;
    const ada = await members.signIn("Ada", {
      beforeOpen: (page) =>
        page.routeWebSocket(/\/socket/, (ws) => {
          if (!online) return ws.close();
          connection = { page: ws, server: ws.connectToServer() };
        }),
    });
    const grace = await members.signIn("Grace");

    online = false;
    await connection!.server.close();
    await connection!.page.close();
    await expect(ada.connection()).toHaveText("Reconnecting…");
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeDisabled();
    await ada.composer().fill("Typed while offline");
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeDisabled();

    await grace.send("Sent while Ada was away");
    await expect(grace.message("Sent while Ada was away")).not.toHaveAttribute("aria-busy");

    online = true;
    await expect(ada.connection()).toHaveCount(0, { timeout: 20_000 });
    await expect(ada.message("Sent while Ada was away")).toBeVisible();
    await expect(ada.composer()).toHaveValue("Typed while offline");
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});
