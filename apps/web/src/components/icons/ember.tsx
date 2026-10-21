import type { SVGProps } from "react";

// Ember's own line icons, copied from ember-rust's crates/views/templates/components/icons.html.
// The paths and the 1.7 stroke are the design: copy new ones from there verbatim.

export type EmberIconProps = SVGProps<SVGSVGElement>;

function EmberIcon(props: EmberIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function Flame(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="M12 3c-3 3-1.5 5.5.5 7.5 1.5 1.5 1 3-1 3.5-1.5.4-3-1-3.5-2.5C5 15 6.5 21 12 21c4.4 0 7-3 7-6.5C19 9.5 13 7.5 12 3Z" />
    </EmberIcon>
  );
}

export function User(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </EmberIcon>
  );
}

export function Mail(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </EmberIcon>
  );
}

export function Lock(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
    </EmberIcon>
  );
}

export function Eye(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </EmberIcon>
  );
}

export function Camera(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="4" />
    </EmberIcon>
  );
}

export function ArrowRight(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </EmberIcon>
  );
}

export function Search(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </EmberIcon>
  );
}

export function Menu(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </EmberIcon>
  );
}

export function Close(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="m6 6 12 12M6 18 18 6" />
    </EmberIcon>
  );
}

/** The welcome card's link, which ember-rust draws inline in rooms/show/_invitation.html rather than from icons.html. */
export function Link(props: EmberIconProps) {
  return (
    <EmberIcon {...props}>
      <path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2" />
    </EmberIcon>
  );
}

/**
 * Drawings inline in ember-rust's templates rather than from icons.html, with a 1.75 stroke: the room
 * icon picker's (rooms/layouts/_icon_picker.html) and the unsaved changes dialog's
 * (components/unsaved_changes.html).
 */
function InlineIcon(props: EmberIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function IconPickerChevron(props: EmberIconProps) {
  return (
    <InlineIcon strokeLinejoin="round" {...props}>
      <path d="m9 5 7 7-7 7" />
    </InlineIcon>
  );
}

/** The × that closes the icon picker and the unsaved changes dialog. */
export function Dismiss(props: EmberIconProps) {
  return (
    <InlineIcon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </InlineIcon>
  );
}

export function IconPickerSearch(props: EmberIconProps) {
  return (
    <InlineIcon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </InlineIcon>
  );
}

/** The unsaved changes dialog's square and pencil. */
export function PencilSquare(props: EmberIconProps) {
  return (
    <InlineIcon strokeLinejoin="round" {...props}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1L22 8a2.1 2.1 0 0 0-3-3Z" />
    </InlineIcon>
  );
}
