import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_CUSTOM_STYLES_LENGTH, type Account } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { Alert, Check } from "@/components/icons/campfire";
import { TranslationButton } from "@/components/translation-button";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, changeCustomStyles, fetchCustomStyles, isSignedOut } from "@/lib/api";
import { Panel, SettingsPage } from "./settings-page";

interface Props {
  /** Called with the workspace as saving the CSS leaves it, for every page to apply. */
  onAccountChanged: (account: Account) => void;
  /** Says why loading or saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's Custom CSS page (accounts/custom_styles/edit.html), where administrators write CSS for
 * every page, which saving applies at once, here and in everyone's tabs, with the notice "✓". Ctrl or
 * ⌘ + Enter saves too. Anyone else is sent to workspace settings with an alert, where ember-rust's
 * answers an empty 403 page.
 */
export function CustomStylesPage({ onAccountChanged, onFailed }: Props) {
  const [customStyles, setCustomStyles] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const flash = useFlash();
  const mounted = useMounted();
  useTitle("Custom styles");

  useEffect(() => {
    let stopped = false;
    fetchCustomStyles().then(
      (customStyles) => !stopped && setCustomStyles(customStyles),
      (error: unknown) => {
        if (stopped && !isSignedOut(error)) return;
        if (!(error instanceof ApiError && error.status === 403)) return onFailed(error);
        navigate(WORKSPACE_SETTINGS_PATH, { replace: true });
        flash("alert", error.message);
      },
    );
    return () => void (stopped = true);
  }, [flash, onFailed]);

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (customStyles === null || saving) return;
    setSaving(true);
    changeCustomStyles(customStyles).then(
      (account) => {
        onAccountChanged(account);
        if (!mounted.current) return;
        setSaving(false);
        flash("notice", "✓");
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };
  const saveOnCtrlEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    save();
  };

  return (
    <SettingsPage back={WORKSPACE_SETTINGS_PATH}>
      {/* `.panel--wide`: 900px. */}
      <Panel aria-busy={customStyles === null} className="relative w-[900px] text-center">
        <form onSubmit={save} onKeyDown={saveOnCtrlEnter} className="flex flex-col gap-x-[1ch] gap-y-4">
          <div className="absolute top-4 left-4">
            <TranslationButton translations="custom_styles" />
          </div>
          <div className="mx-[1ch] px-[2ch] max-md:px-3">
            <h1 id="custom-styles-heading" className="text-[23px] font-bold">
              Custom CSS
            </h1>
            <p className="mb-[1em] flex flex-wrap items-center justify-center gap-x-[0.5ch]">
              <span>Add custom CSS styles.</span>
              <Alert width={16} height={16} className="size-4" />
              <span>Use Caution: you could break things.</span>
            </p>
          </div>
          <textarea
            id="account_custom_styles"
            aria-labelledby="custom-styles-heading"
            rows={16}
            maxLength={MAX_CUSTOM_STYLES_LENGTH}
            placeholder="Add CSS styles…"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={customStyles ?? ""}
            onChange={(event) => setCustomStyles(event.target.value)}
            disabled={customStyles === null}
            // Campfire's `.input--code`, in 16px, where ember-rust's phones get 13px, so iOS doesn't zoom in.
            className="w-full resize-none rounded-[9px] border bg-transparent px-[0.8em] py-[0.5em] font-mono text-base break-words whitespace-pre-wrap focus:border-selected-dark"
          />
          {/* A `.btn--reversed` circle holding Campfire's check, which darkens under the pointer: 36px, or 44px for fingers. */}
          <button
            type="submit"
            disabled={customStyles === null || saving}
            className="mx-auto grid size-9 cursor-pointer place-items-center rounded-full bg-primary text-[17px] transition-[filter] hover:brightness-[0.7] disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale touch:size-11"
          >
            <Check tone="reversed" width={20} height={20} className="h-5 w-[1.3em]" />
            <span className="sr-only">Save changes</span>
          </button>
        </form>
      </Panel>
    </SettingsPage>
  );
}
