import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft } from "@/components/icons/campfire";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { cn } from "@/lib/utils";
import { HEADER_BUTTON, PageHeader } from "./page-header";

/**
 * ember-rust's pages beside rooms, such as rooms/layouts/_new.html and _edit.html: Go Back in the top
 * bar, with any `links` the page has at its other end, then panels on the canvas, which scrolls.
 */
export function SettingsPage({ back, links, children }: { back: string; links?: ReactNode; children: ReactNode }) {
  return (
    <>
      <PageHeader>
        <PageLink href={back} className={HEADER_BUTTON}>
          <ArrowLeft className="size-5" />
          <span className="sr-only">Go Back</span>
        </PageLink>
        {links && <div className="ml-auto flex items-center gap-[1ch]">{links}</div>}
      </PageHeader>
      <MainContent className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        {children}
      </MainContent>
    </>
  );
}

/** ember-rust's `.panel.mb-settings-panel`: a 640px card, narrower on phones, with no gap between two in a row. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "mx-auto my-7 w-[640px] max-w-[calc(100%-48px)] rounded-[14px] border bg-background p-[clamp(20px,3vw,32px)] text-start [&+&]:mt-0",
        "max-md:my-4 max-md:max-w-[calc(100%-24px)] max-md:rounded-xl max-md:px-4 max-md:py-5",
        className,
      )}
      {...props}
    />
  );
}

/** ember-rust's `.mb-page-heading`, whose title a panel sets at 23px. */
export function PageHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="mb-1.5 text-[23px] leading-[1.3] font-[650]">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </header>
  );
}
