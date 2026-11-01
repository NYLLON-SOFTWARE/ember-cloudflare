import { UPDATING_EMBER, type ReleaseCheck } from "@ember/protocol";
import { BUTTON } from "./email-settings";

// The Ember version card at the end of General, for administrators: the release this Ember is, and once
// GitHub names a newer one, that it's out, with its notes and how to update, as the project's owner
// asked (2026-10-31), while the rail's Admin has a dot. A copy made with Deploy to Cloudflare gets a pull
// request for each release once it has the Update Ember workflow, which Cloudflare's copy leaves out
// (docs/self-hosting.md#updating), and the docs say how anything else updates.

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

/** How a copy made with Deploy to Cloudflare updates, which the card says while a newer release is out. */
export const HOW_COPIES_UPDATE =
  "A copy made with Deploy to Cloudflare gets a pull request for each release from its Update Ember workflow, every Monday or when it's run from the repository's Actions tab, once the workflow is added to the copy, as How to update says. Merging it updates Ember.";

/** The release this Ember is, and whether a newer one is out, once the Worker has said, as it does only for administrators. */
export function EmberVersion({ check }: { check: ReleaseCheck | null }) {
  if (!check) return null;
  const { release, newest } = check;
  const newer = newest?.newer ? newest : null;
  return (
    <section aria-labelledby="ember-version-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <div>
        <h2 id="ember-version-heading" className="text-base font-semibold">
          {newer ? `Ember ${newer.release} is available` : `Ember ${release}`}
        </h2>
        <p className={NOTE}>{newer ? `This is Ember ${release}.` : newest ? "This is the newest release." : "GitHub didn't say whether a newer release is out."}</p>
      </div>
      {newer && (
        <>
          <p className={NOTE}>{HOW_COPIES_UPDATE}</p>
          <div className="flex flex-wrap gap-[1ch]">
            <a href={newer.notes} target="_blank" rel="noopener" className={BUTTON}>
              What's new
            </a>
            <a href={UPDATING_EMBER} target="_blank" rel="noopener" className={BUTTON}>
              How to update
            </a>
          </div>
        </>
      )}
    </section>
  );
}
