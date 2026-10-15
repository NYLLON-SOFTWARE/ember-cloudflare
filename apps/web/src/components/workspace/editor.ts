import { lazy } from "react";

export type { RichTextEditorHandle } from "./rich-text-editor";

/**
 * The message editor, Lexxy, whose code is bigger than the rest of the app's, so it loads as the
 * first editor shows: as a room opens, with its composer.
 */
export const RichTextEditor = lazy(() => import("./rich-text-editor"));
