import type { HelpContact as Contact } from "@ember/protocol";
import { Lifebuoy } from "@/components/icons/campfire";
import { Version } from "@/components/version";

/**
 * Whom to ask for help, under the sign-in card: the first administrator, by email, and the version,
 * as ember-rust's accounts/_help_contact.html shows them. Nothing until there's an administrator.
 */
export function HelpContact({ contact, version }: { contact: Contact | null; version: string }) {
  if (!contact) return null;
  return (
    <div className="my-8 w-full text-center">
      <a
        href={`mailto:"${contact.name}" <${contact.emailAddress}>`}
        title={`Email ${contact.name}`}
        className="inline-flex max-w-full items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground touch:min-h-11"
      >
        <Lifebuoy className="size-[1.3em] flex-none" />
        <span className="min-w-0 break-words">{contact.emailAddress}</span>
      </a>
      <Version version={version} className="my-4" />
    </div>
  );
}
