import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { CloseCode, parseServerFrame, type DirectoryUser, type Me, type User, type WorkspaceServerFrame } from "@ember/protocol";
import { fetchMe, fetchSidebar, isSignedOut, workspaceSocketUrl, type SidebarCopy } from "@/lib/api";
import { reconnectingSocket } from "@/lib/reconnecting-socket";
import { NO_ROOM_LIST, roomListReducer } from "@/lib/room-list";

/**
 * How long a tab is hidden before showing it loads the sidebar again, as Campfire's
 * refresh_room_controller.js waits (`REFRESH_AFTER_HIDDEN_TIMEOUT`).
 */
export const RELOAD_AFTER_HIDDEN_MS = 60_000;

/**
 * After a deploy, the workspace socket waits 2 to 10 seconds to connect again, where a room's waits a
 * quarter of a second to two. Each tab's room socket then comes back first, as the page shown needs,
 * and the Workspace, which every tab's sockets and sidebar ask, gets its calls spread over longer: with
 * a thousand tabs, `pnpm perf`'s tabs scenario found the rooms back as fast as without this socket.
 */
const DEPLOY_SPREAD_MS = [2_000, 10_000] as const;

/**
 * `task`, one run at a time. Called while it runs, it runs again once that run is over, once for all
 * the calls made meanwhile, since the run under way started before them. Each call settles as the first
 * run to start after it does.
 */
export function oneAtATime(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let next: Promise<void> | null = null;
  const run = () => (running = task().finally(() => (running = null)));
  return () => {
    if (next) return next;
    if (!running) return run();
    next = running
      .catch(() => {})
      .then(() => {
        next = null;
        return run();
      });
    return next;
  };
}

/** The people directory, as far as the workspace socket keeps it current. */
interface Directory {
  /** Loads it again, as the sidebar does by itself. */
  reload: () => void;
  /** Changes someone in it, as the socket says they are now. */
  update: (user: DirectoryUser) => void;
}

const NO_DIRECTORY: Directory = { reload: () => {}, update: () => {} };

/** Whether `you` and `me` are the same person, as they are now. */
const isSame = (you: Me, me: Me) => you.id === me.id && you.name === me.name && you.administrator === me.administrator;

/**
 * Someone's sidebar, which loads again each time the tab's workspace socket connects, the first time
 * included, as ember-rust's rooms_list_controller.js reloads its frame, since nothing that changed
 * while it wasn't connected reached it. Meanwhile the socket marks rooms unread and read. It loads
 * again when the tab is shown after more than a minute hidden too, as `refresh-room:visible` reloads
 * it (helpers/users.rs), which ember-rust does on a room's page and this does on every page. `refresh`
 * asks for it again, settling once a list asked for since has come, or failing as that did.
 *
 * `onSessionChanged` hears when who the browser's session signs in changes: null once it has expired,
 * whoever another tab signed in as, or `me` as they are now, once they've been made an administrator,
 * say. The people `directory` loads again each time the sidebar does by itself, and hears whoever the
 * socket says has changed.
 */
export function useSidebar(me: Me, onSessionChanged: (me: Me | null) => void, directory: Directory = NO_DIRECTORY) {
  const [{ list }, change] = useReducer(roomListReducer, NO_ROOM_LIST);
  const [refresh] = useState(() => {
    // The last list the server sent, which it says is still current rather than send again.
    let copy: SidebarCopy | null = null;
    return oneAtATime(async () => {
      change({ type: "asked" });
      try {
        copy = await fetchSidebar(copy);
        change({ type: "loaded", list: copy.sidebar });
      } catch (error) {
        change({ type: "unanswered" });
        throw error;
      }
    });
  });
  const sessionChanged = useEffectEvent(onSessionChanged);
  const reloadPeople = useEffectEvent(() => directory.reload());
  const isSomeoneElse = useEffectEvent((user: User) => user.id !== me.id);
  // Who the session signs in, as the socket says each time it connects and whenever they change.
  const signsIn = useEffectEvent((you: Me) => {
    if (!isSame(you, me)) sessionChanged(you);
  });
  const changed = useEffectEvent((user: DirectoryUser) => {
    directory.update(user);
    if (user.id === me.id) signsIn({ id: user.id, name: user.name, administrator: user.role === "administrator" });
  });

  useEffect(() => {
    let closed = false;
    // A session that has expired goes to sign in. Otherwise a list that doesn't come leaves the sidebar
    // as it is, until it loads again.
    const reload = () => {
      reloadPeople();
      void refresh().catch((error) => !closed && isSignedOut(error) && sessionChanged(null));
    };

    const onMessage = (data: string) => {
      const frame = parseServerFrame<WorkspaceServerFrame>(data);
      switch (frame?.type) {
        case "welcome":
          if (isSomeoneElse(frame.you)) {
            // Another tab signed this browser out and in as someone else, and the cookie went with it.
            workspace.close();
            return sessionChanged(frame.you);
          }
          workspace.connected();
          signsIn(frame.you);
          return reload();
        case "room.unread":
        case "room.read":
          return change({ type: "marked", roomId: frame.roomId, unread: frame.type === "room.unread" });
        case "user.updated":
          return changed(frame.user);
      }
    };

    // A refused upgrade looks like any other failure, so ask whether the session has expired, as when
    // the Workspace says to reconnect, which it does when this browser signs out.
    const onClose = (code: number, opened: boolean) => {
      if (!opened || code === CloseCode.Reconnect) void fetchMe().catch((error) => !closed && isSignedOut(error) && sessionChanged(null));
      return true;
    };

    // Unlike Campfire's, a page that loads hidden has been hidden since it loaded.
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > RELOAD_AFTER_HIDDEN_MS) reload();
      hiddenAt = null;
    };

    reload();
    const workspace = reconnectingSocket({ url: workspaceSocketUrl, onMessage, onClose, deploySpreadMs: DEPLOY_SPREAD_MS });
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      closed = true;
      workspace.close();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);

  return { list, change, refresh };
}
