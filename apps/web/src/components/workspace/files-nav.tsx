import type { ComponentType } from "react";
import { FILES_PATH, filesPath, type FilesPlace, type Me } from "@ember/protocol";
import { MultiplePages, PageEdit, Star, StarSolid, type IconoirIconProps } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { fileOpened, useFiles } from "@/hooks/use-files";
import { navigate } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { openAddress } from "./file-list";
import { PLACE_TITLES } from "./files-page";

/** A link in the column, as the sidebar's rows are. */
const ROW =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-sm leading-[22px] text-foreground no-underline touch:min-h-11 hover:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold";

const PLACES: Array<{ place: FilesPlace; Icon: ComponentType<IconoirIconProps> }> = [
  { place: "all", Icon: MultiplePages },
  { place: "canvases", Icon: PageEdit },
];

/**
 * The Files page's column, in the sidebar's place, after Slack's: All files and Canvases, then Starred,
 * which lists the files you've starred, each opening its file, or says how to star one.
 */
export function FilesNav({ place }: { me: Me; place: FilesPlace }) {
  const { files } = useFiles();
  const starred = files?.filter((file) => file.starred) ?? [];
  return (
    <nav
      aria-label="Files"
      className="flex h-full flex-col gap-3.5 overflow-x-hidden overflow-y-auto bg-surface px-3 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] narrow:px-2 max-md:gap-4 max-md:px-2.5 max-md:pt-4"
    >
      <h2 className="flex min-h-7 items-center px-1.5 text-[17px] leading-6 font-[650] max-md:pr-10">
        <PageLink href={FILES_PATH} className="hover:underline">
          Files
        </PageLink>
      </h2>
      <ul className="flex flex-col gap-[3px]">
        {PLACES.map(({ place: shown, Icon }) => (
          <li key={shown}>
            <PageLink href={filesPath(shown)} aria-current={place === shown ? "page" : undefined} className={ROW}>
              <Icon className="size-[18px] shrink-0 text-muted-foreground" />
              {PLACE_TITLES[shown]}
            </PageLink>
          </li>
        ))}
      </ul>
      <hr className="mx-1.5 border-t" />
      <section aria-labelledby="files-starred" className="flex flex-col gap-[3px]">
        <PageLink id="files-starred" href={filesPath("starred")} aria-current={place === "starred" ? "page" : undefined} className={ROW}>
          <Star className="size-[18px] shrink-0 text-muted-foreground" />
          {PLACE_TITLES.starred}
        </PageLink>
        {files !== null && starred.length === 0 && (
          <p className="px-[9px] text-[13px] leading-[18px] text-muted-foreground">
            Click the <StarSolid aria-label="star" className="inline size-3.5 align-[-2px]" /> on any file to add it here for later.
          </p>
        )}
        <ul className="flex flex-col gap-[3px]">
          {starred.map((file) => (
            <li key={file.id}>
              <a
                href={openAddress(file)}
                {...(file.kind === "file" && { target: "_blank", rel: "noopener" })}
                onClick={(event) => {
                  fileOpened(file);
                  if (file.kind !== "canvas") return;
                  event.preventDefault();
                  navigate(openAddress(file));
                }}
                className={cn(ROW, "pl-[37px] text-muted-foreground hover:text-foreground")}
              >
                <span className="truncate">{file.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </nav>
  );
}
