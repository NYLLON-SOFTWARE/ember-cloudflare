import { createContext } from "react";
import type { Message } from "@ember/protocol";

/** A message Forward message is open on, and what opened it. */
export interface Forwarding {
  message: Message;
  opener: HTMLElement;
}

/**
 * Opens Forward message on a message, in the workspace rather than in the message, so it stays open, saying
 * so, should the message be deleted meanwhile. Left out, as where a message shows alone, the message opens it.
 */
export const ForwardContext = createContext<((forwarding: Forwarding) => void) | null>(null);
