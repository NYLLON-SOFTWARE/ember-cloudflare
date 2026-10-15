import { Fragment, useEffect, useRef, useState } from "react";
import { Globe } from "@/components/icons/campfire";
import { useAccount } from "@/hooks/use-account";
import { TRANSLATIONS, type TranslationKey } from "@/lib/translations";

// ember-rust's translation button (crates/views/src/helpers/translations.rs, drawn by Campfire's
// buttons.css and base.css at zz-ember.css's sizes): a globe beside a field that opens what the field
// asks for in seven languages. Like ember-rust's, it's a <details>, which opens and closes by itself,
// and its globe can't be reached with Tab.

/** `translations` under a globe, unless the workspace hides translation buttons, as it does until an administrator shows them. */
export function TranslationButton({ translations }: { translations: TranslationKey }) {
  return useAccount().hideTranslationButtons ? null : <Translations translations={translations} />;
}

function Translations({ translations }: { translations: TranslationKey }) {
  const details = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // As Campfire's popup_controller.js does, a click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const closeOnClickOutside = (event: MouseEvent) => {
      if (!details.current!.contains(event.target as Node)) details.current!.open = false;
    };
    document.addEventListener("click", closeOnClickOutside);
    return () => document.removeEventListener("click", closeOnClickOutside);
  }, [open]);

  const toggled = () => {
    setOpen(details.current!.open);
    // On a narrow screen the menu keeps to the room on its right, which popup_controller.js measures as it
    // opens. It measures the window, which a phone widens to fit a menu already too wide for the screen,
    // so this measures the page, which stays the screen's width.
    if (details.current!.open) {
      menu.current!.style.setProperty("--max-width", `${document.documentElement.clientWidth - menu.current!.getBoundingClientRect().left}px`);
    }
  };

  return (
    <details ref={details} onToggle={toggled} onKeyDown={(event) => event.key === "Escape" && (event.currentTarget.open = false)} className="relative">
      {/* A circle `.btn`, as Campfire draws one holding only an icon: 36px, or 44px for fingers. */}
      <summary
        tabIndex={-1}
        className="grid size-9 cursor-pointer list-none place-items-center rounded-full border bg-background touch:size-11 [&::-webkit-details-marker]:hidden"
      >
        {/* Campfire's 1.3em wide in the 20px it's given. */}
        <Globe tone="color" width={20} height={20} className="h-5 w-[1.3em]" />
        <span className="sr-only">Translate</span>
      </summary>
      {/* Campfire's `.language-list-menu` and `.language-list` (base.css), under the globe, in the text around it. */}
      <div
        ref={menu}
        className="absolute z-3 mx-[1ch] w-max max-w-[40ch] overflow-clip [--max-width:40ch] rounded-[0.5em] border border-border bg-border shadow-[0_8px_24px_var(--color-menu-shadow)] max-[100ch]:max-w-[calc(var(--max-width)-1ch)]"
      >
        <dl className="m-0 grid grid-cols-[min-content_1fr] justify-start gap-x-[1ch] gap-y-2 px-[2ch] py-4 text-start">
          {TRANSLATIONS[translations].map(([flag, text]) => (
            <Fragment key={flag}>
              <dt>{flag}</dt>
              <dd>{text}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </details>
  );
}
