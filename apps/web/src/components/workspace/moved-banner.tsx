import type { MouseEvent } from "react";
import { Xmark } from "@/components/icons/iconoir";
import { moveTo } from "@/lib/custom-domain";

/** What MovedNotice shows, loaded with the pages: Ember's new address, Go there, and Close. */
export function MovedBanner({ customDomain, there, onClose }: { customDomain: string | null; there: string; onClose: () => void }) {
  // As a page moving as it opens does, unless it's opened somewhere else: with a modifier key, say.
  const goThere = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void moveTo(customDomain);
  };
  return (
    <div role="status" className="flex items-center gap-3 rounded-[10px] border bg-background py-1 ps-4 pe-1 shadow-[0_8px_24px_#00000012]">
      <p className="min-w-0">
        Ember has moved to <strong className="wrap-anywhere">{customDomain}</strong>.{" "}
        <a href={there} onClick={goThere} className="font-medium whitespace-nowrap underline">
          Go there
        </a>
      </p>
      <button type="button" aria-label="Close" onClick={onClose} className="flex size-11 flex-none items-center justify-center rounded-lg hover:bg-hover">
        <Xmark className="size-5" />
      </button>
    </div>
  );
}
