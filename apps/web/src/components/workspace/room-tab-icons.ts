import { lazy, type ComponentType } from "react";
import type { RoomTabKind } from "@ember/protocol/library";
import { EmptyPage, Folder, Link, PageEdit, type IconoirIconProps } from "@/components/icons/iconoir";

/** The tab shown over a room: Messages, Files & links, or one the members added, by its id. */
export type ShownTab = "messages" | "files" | string;

/** Each kind of tab's icon, in the strip and Edit tabs. */
export const TAB_ICONS: Record<RoomTabKind, ComponentType<IconoirIconProps>> = { file: EmptyPage, link: Link, folder: Folder, canvas: PageEdit };

/**
 * A canvas's editor, with Tiptap, which loads the first time a canvas opens. It's loaded from here, in the app's
 * own chunk, rather than from the tabs' panels, which load lazily themselves: Rolldown takes a chunk loaded
 * from a lazy chunk for one that can load without the app's, and would move React and the rest of what the
 * two share out of the app's script.
 */
export const CanvasEditor = lazy(() => import("./canvas-editor").then(({ CanvasEditor }) => ({ default: CanvasEditor })));
