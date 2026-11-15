import { FILES_PATH } from "@ember/protocol";
import { MultiplePages } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";

/** The rail's Files, which opens the Files page, marked while it's the page shown. */
export function FilesRailLink({ current, className }: { current: boolean; className: string }) {
  return (
    <PageLink href={FILES_PATH} aria-current={current ? "page" : undefined} className={className}>
      <MultiplePages className="size-[22px]" />
      <span>Files</span>
    </PageLink>
  );
}
