// Lexxy ships no types. These are the parts of @37signals/lexxy 0.9.24 that rich-text-editor.tsx uses.
declare module "@37signals/lexxy" {
  /** Settings for every editor (`global`) and for each preset of them (`default`). */
  export function configure(settings: { global?: Record<string, unknown>; default?: Record<string, unknown> }): void;

  /** The parts of Lexical's ElementNode that Campfire's node uses. */
  class ElementNode {
    constructor(key?: string);
    readonly __key: string;
    exportJSON(): Record<string, unknown>;
    updateFromJSON(serialized: Record<string, unknown>): this;
  }

  /** The Lexical Lexxy is built on, whose nodes an extension's must extend. */
  export const Lexical: { ElementNode: typeof ElementNode };

  /** What an editor allows and holds beyond Lexxy's own. */
  export class Extension {
    constructor(editorElement: HTMLElement);
    get allowedElements(): Array<string | { tag: string; attributes: string[] }>;
    get lexicalExtension(): unknown;
    defineExtension(extension: { name: string; nodes: unknown[] }): unknown;
  }
}
