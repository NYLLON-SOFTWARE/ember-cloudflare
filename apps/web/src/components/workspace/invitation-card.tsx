import { Link } from "@/components/icons/ember";
import { TranslationButton } from "@/components/translation-button";
import { JoinLinkButtons, joinUrl } from "./join-link";

// ember-rust's welcome card (crates/views/templates/rooms/show/_invitation.html, styled by
// `.mb-welcome-card` and the `.mb-invite-*` rules in zz-ember.css).

/** A `.btn` in `.mb-invite-actions`: a 38px square, 44px for fingers. */
const BUTTON = "grid size-[38px] flex-none cursor-pointer place-items-center rounded-[9px] border bg-background text-sm touch:size-11";

/** Welcomes people to the workspace's first room with its join link, to copy or share. */
export function InvitationCard({ joinCode }: { joinCode: string }) {
  const url = joinUrl(joinCode);

  return (
    <div className="mx-6 mb-1 w-[560px] max-w-[calc(100%-48px)] rounded-[14px] border bg-background p-[22px] max-[68.75rem]:mx-[18px] max-[68.75rem]:max-w-[calc(100%-36px)] max-[68.75rem]:p-[18px] max-md:mx-3 max-md:max-w-[calc(100%-24px)] max-md:p-4">
      <div className="mb-5 flex items-start gap-3.5 max-md:mb-3.5 max-md:gap-3">
        <img src="/ember-icon.png" alt="Ember" width={44} height={44} className="size-11 flex-none object-contain" />
        <div>
          <h2 className="mb-[3px] text-[17px] font-[650] max-md:text-[15px]">Welcome to Ember</h2>
          <p className="text-muted-foreground max-md:text-[13px]">To invite people to chat, share the join link below.</p>
        </div>
        <TranslationButton translations="invite_message" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[9px] border px-[9px] py-[7px] max-[68.75rem]:basis-full touch:min-h-11">
          <span id="invite_label" className="sr-only">
            Share to invite more people
          </span>
          <Link width={17} height={20} className="flex-none text-muted-foreground" />
          {/* 16px for fingers, where ember-rust keeps 13px, so iOS doesn't zoom in when it's tapped. */}
          <input
            type="text"
            id="invite_url"
            value={url}
            aria-labelledby="invite_label"
            readOnly
            className="w-full min-w-0 bg-transparent p-0 font-mono text-[13px] text-ellipsis text-foreground touch:text-base"
          />
        </label>
        <div className="flex flex-none items-center gap-2">
          <JoinLinkButtons url={url} className={BUTTON} />
        </div>
      </div>
    </div>
  );
}
