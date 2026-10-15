import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef, useState } from "react";
import { CloseCode, parseServerFrame, type Account, type DirectoryUser, type Me, type RoomId, type User, type WorkspaceServerFrame } from "@ember/protocol";
import { fetchMe, fetchSidebar, isSignedOut, workspaceSocketUrl, type SidebarCopy } from "@/lib/api";
import { reconnectingSocket } from "@/lib/reconnecting-socket";
import { NO_ROOM_LIST, roomListReducer, type RoomAnswer } from "@/lib/room-list";

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
  /** Loads it again, as the sidebar does by itself, settling once it has or failed. */
  reload: () => Promise<void>;
  /** Changes someone in it, as the socket says they are now. */
  update: (user: DirectoryUser) => void;
}

const NO_DIRECTORY: Directory = { reload: async () => {}, update: () => {} };

/** Whether `you` and `me` are the same person, as they are now. */
const isSame = (you: Me, me: Me) => you.id === me.id && you.name === me.name && you.administrator === me.administrator;

/**
 * Someone's sidebar, which loads again each time the tab's workspace socket connects, the first time
 * included, as ember-rust's rooms_list_controller.js reloads its frame, since nothing that changed
 * while it wasn't connected reached it. Meanwhile the socket brings rooms as they're made, changed and
 * deleted, and as this person is put in them and taken out, marks rooms unread and read, moves DMs as
 * messages come in them, and brings the stars saved in any of their tabs. It loads again when the tab
 * is shown after more than a minute hidden too, as `refresh-room:visible` reloads it
 * (helpers/users.rs), which ember-rust does on a room's page and this does on every page. `refresh`
 * asks for it again, settling once a list asked for since has come, or failing as that did.
 *
 * `onSessionChanged` hears when who the browser's session signs in changes: null once it has expired,
 * whoever another tab signed in as, or `me` as they are now, once they've been made an administrator,
 * say. The people `directory` loads again each time the sidebar does by itself, and hears whoever the
 * socket says has changed. `onAccountChanged` hears the workspace as the socket says it is, each time
 * it connects and whenever an administrator changes it. `onGone` hears of each room the socket says is
 * gone as it leaves the list.
 */
export function useSidebar(
  me: Me,
  onSessionChanged: (me: Me | null) => void,
  directory: Directory = NO_DIRECTORY,
  onAccountChanged: (account: Account) => void = () => {},
  onGone: (roomId: RoomId) => void = () => {},
) {
  const [{ list }, change] = useReducer(roomListReducer, NO_ROOM_LIST);
  // How many of the workspace socket's frames have said what became of a room, and the number of the
  // last to speak of each room.
  const roomFrames = useRef({ count: 0, lastOf: new Map<RoomId, number>() });
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
  const accountChanged = useEffectEvent(onAccountChanged);
  // A failed load leaves the avatars as they are until the next.
  const reloadPeople = useEffectEvent(() => void directory.reload().catch(() => {}));
  const gone = useEffectEvent(onGone);
  const isSomeoneElse = useEffectEvent((user: User) => user.id !== me.id);
  // Who the session signs in as last heard, ahead of `me` until the page takes the change: two changes
  // can come before it takes the first.
  const heard = useRef(me);
  useLayoutEffect(() => {
    heard.current = me;
  }, [me]);
  // Who the session signs in, as the socket says each time it connects and whenever they change.
  const signsIn = useEffectEvent((you: Me) => {
    if (isSame(you, heard.current)) return;
    heard.current = you;
    sessionChanged(you);
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

    // What this connection has said changed, the person signed in or the workspace, which can come
    // before its welcome. The welcome may have read it before that change, so it doesn't undo it. Each
    // try starts afresh, after a close or a socket that stopped answering alike.
    let toldOf = { you: false, account: false };
    const onConnecting = () => void (toldOf = { you: false, account: false });
    const heardOf = (roomId: RoomId) => roomFrames.current.lastOf.set(roomId, ++roomFrames.current.count);
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
          if (!toldOf.you) signsIn(frame.you);
          if (!toldOf.account) accountChanged(frame.account);
          return reload();
        case "room.saved":
          heardOf(frame.room.id);
          return change({ type: "saved", room: frame.room });
        case "room.gone":
          heardOf(frame.roomId);
          gone(frame.roomId);
          return change({ type: "gone", roomId: frame.roomId });
        case "room.unread":
        case "room.read":
          return change({ type: "marked", roomId: frame.roomId, unread: frame.type === "room.unread" });
        case "room.active":
          return change({ type: "active", roomId: frame.roomId, at: frame.at });
        case "user.updated":
          if (!isSomeoneElse(frame.user)) toldOf.you = true;
          return changed(frame.user);
        case "favorites.changed":
          return change({ type: "starred", favorites: frame.favorites });
        case "account.updated":
          toldOf.account = true;
          return accountChanged(frame.account);
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
    const workspace = reconnectingSocket({ url: workspaceSocketUrl, onMessage, onConnecting, onClose, deploySpreadMs: DEPLOY_SPREAD_MS });
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      closed = true;
      workspace.close();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);

  /**
   * Called as a room is saved or deleted: what lists it as the server answers, unless the workspace
   * socket has said what became of the room since, which the answer could undo, as with a rename saved
   * in another tab just after. The socket brings this change too, in its turn, if it changed anything.
   */
  const askForRoom = useCallback(() => {
    const asked = roomFrames.current.count;
    return (answer: RoomAnswer) => {
      const roomId = answer.type === "saved" ? answer.room.id : answer.roomId;
      if ((roomFrames.current.lastOf.get(roomId) ?? 0) <= asked) change(answer);
    };
  }, []);

  return { list, change, refresh, askForRoom };
}
