import { useEffect, useState } from "react";
import type { ReleaseCheck } from "@ember/protocol";
import { checkForRelease } from "@/lib/api";
import { whenIdle } from "@/lib/idle";

/**
 * For an administrator, the release this Ember is and the newest one GitHub names, which the Worker is
 * asked for once the page is `ready` and the browser is idle, and again for someone made an
 * administrator. Null until it answers, and for anyone else, or when asking fails, which nothing waits on.
 */
export function useReleaseCheck(administrator: boolean, ready: boolean): ReleaseCheck | null {
  const [check, setCheck] = useState<ReleaseCheck | null>(null);
  const asking = administrator && ready;
  useEffect(() => {
    if (!asking) return;
    let current = true;
    const cancel = whenIdle(
      () =>
        void checkForRelease().then(
          (answer) => current && setCheck(answer),
          () => {},
        ),
    );
    return () => {
      current = false;
      cancel();
    };
  }, [asking]);
  return administrator ? check : null;
}
