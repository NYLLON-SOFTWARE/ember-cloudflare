import { getSchema } from "@tiptap/core";
import { Node, type Schema } from "@tiptap/pm/model";
import { ReplaceStep, Step } from "@tiptap/pm/transform";
import StarterKit from "@tiptap/starter-kit";

// A canvas's document as the room applies its writers' steps to it: in the editor's own schema, made from
// the same Tiptap extensions, configured as the editor configures them (canvas-editor.tsx), which a test
// checks. Loaded only once a canvas is written in (canvas-sessions.ts).

export type CanvasDoc = Node;

/** What the room does with canvases' documents and steps. */
export interface CanvasEditing {
  /** The document `body` holds, or null where it isn't one in the editor's schema. */
  docOf(body: string): CanvasDoc | null;
  /** `doc` with `steps` applied, in order, or null where one of them isn't a step, or doesn't apply. */
  applied(doc: CanvasDoc, steps: unknown[]): CanvasDoc | null;
  /** The steps, as JSON, that take `from` to `to`: one, replacing what differs, or none where nothing does. */
  stepsBetween(from: CanvasDoc, to: CanvasDoc): unknown[];
}

/** The editor's extensions, as it configures them, which make its schema. */
export const canvasExtensions = () => [StarterKit.configure({ link: { openOnClick: false, autolink: true } })];

export function canvasEditing(schema: Schema = getSchema(canvasExtensions())): CanvasEditing {
  return {
    docOf(body) {
      try {
        const doc = Node.fromJSON(schema, JSON.parse(body));
        doc.check();
        return doc;
      } catch {
        return null;
      }
    },
    // Each step checks what it puts in the document fits the schema where it goes, so the document needn't
    // be checked whole, which would cost the room a walk through it for every batch of keystrokes.
    applied(doc, steps) {
      let current = doc;
      for (const json of steps) {
        try {
          const result = Step.fromJSON(schema, json).apply(current);
          if (!result.doc) return null;
          current = result.doc;
        } catch {
          return null;
        }
      }
      return current;
    },
    stepsBetween(from, to) {
      const start = from.content.findDiffStart(to.content);
      if (start === null) return [];
      let { a: endFrom, b: endTo } = from.content.findDiffEnd(to.content)!;
      const overlap = start - Math.min(endFrom, endTo);
      if (overlap > 0) {
        endFrom += overlap;
        endTo += overlap;
      }
      return [new ReplaceStep(start, endFrom, to.slice(start, endTo)).toJSON()];
    },
  };
}
