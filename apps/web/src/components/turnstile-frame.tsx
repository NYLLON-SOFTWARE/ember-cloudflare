import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TURNSTILE_CHECK_PATH } from "@ember/protocol";
import { FLEXIBLE_MIN_WIDTH } from "@/components/turnstile-check";

// Cloudflare Turnstile's check, drawn by a page of Ember's own in a frame (`TURNSTILE_CHECK_PATH`), for
// the pages the app shows without loading them afresh, whose policy doesn't let Turnstile's script load:
// Set up Turnstile, and the sign-in page's form that asks Ember to email a code. The check page says what
// came of the check by a message to the page that framed it.

/** What the check page tells the page that framed it of the check, as its script says (the Worker's turnstile.ts). */
export type CheckSaid = { token: string } | { expired: true } | { error: string } | { unavailable: true };

function isCheckSaid(value: unknown): value is CheckSaid {
  if (typeof value !== "object" || value === null) return false;
  const said = value as Record<string, unknown>;
  return typeof said.token === "string" || said.expired === true || typeof said.error === "string" || said.unavailable === true;
}

/**
 * The widget's check, which the check page draws with `siteKey` in a frame as wide as the step, in the
 * page's appearance, compact where the step is narrower than it draws, telling `onSaid` what came of it.
 */
export function CheckFrame({ siteKey, onSaid }: { siteKey: string; onSaid: (said: CheckSaid) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // Found before it's drawn, since the check keeps the size it's drawn at.
  const [size, setSize] = useState<"flexible" | "compact" | null>(null);
  // The callback as it is now, for what the frame says later.
  const heard = useRef(onSaid);
  useLayoutEffect(() => {
    heard.current = onSaid;
  });

  useLayoutEffect(() => setSize((box.current?.clientWidth ?? 0) >= FLEXIBLE_MIN_WIDTH ? "flexible" : "compact"), []);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      // Only the check page, in this frame, at Ember's own origin, says what came of the check.
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const said: unknown = (event.data as { turnstileCheck?: unknown } | null)?.turnstileCheck;
      if (isCheckSaid(said)) heard.current(said);
    };
    addEventListener("message", listen);
    return () => removeEventListener("message", listen);
  }, []);

  const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  // As tall as the check draws at its size, so that nothing moves as it appears.
  return (
    <div ref={box} className={size === "compact" ? "h-[140px]" : "h-[65px]"}>
      {size && (
        <iframe
          ref={frame}
          title="Turnstile's check"
          src={`${TURNSTILE_CHECK_PATH}#${new URLSearchParams({ site_key: siteKey, theme, size })}`}
          className="block size-full border-0"
        />
      )}
    </div>
  );
}

interface Props {
  siteKey: string;
  /** Called with a token once the check passes, and with null once that token is no longer good, or the check fails. */
  onToken: (token: string | null) => void;
  /** Called if Turnstile's script doesn't load, when there's no check to pass. */
  onUnavailable: () => void;
}

/** Turnstile's check in its frame, saying what came of it as `TurnstileCheck` does, for a form that sends the token itself. */
export function FramedTurnstileCheck({ siteKey, onToken, onUnavailable }: Props) {
  const heard = (said: CheckSaid) => {
    if ("token" in said) return onToken(said.token);
    if ("unavailable" in said) return onUnavailable();
    // Turnstile checks again by itself once a token expires or a challenge times out, giving a new token.
    onToken(null);
  };
  return <CheckFrame siteKey={siteKey} onSaid={heard} />;
}
