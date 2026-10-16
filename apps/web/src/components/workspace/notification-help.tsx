import { useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { Platform } from "@ember/protocol";
import {
  Disclosure,
  ExternalGear,
  ExternalInstall,
  ExternalShare,
  ExternalSliders,
  ExternalSwitch,
  ExternalWeb,
  InstallEdge,
  Lock,
  MenuDotsVertical,
  NotificationBellAlert,
  type CampfireIconProps,
} from "@/components/icons/campfire";
import { useMediaQuery } from "@/hooks/use-media-query";
import { canInstall, givesInstallSteps, promptInstall, subscribeToInstallPrompt } from "@/lib/install-prompt";

// ember-rust's help with turning notifications on (crates/views/templates/pwa/_browser_settings.html,
// _system_settings.html and _install_instructions.html), styled as Campfire's base.css styles
// `.notifications-help`. Its steps are for the browser and system the Worker reads from the user agent,
// as ember-rust's are. A section's sides are Campfire's `--inline-space`, which the setup dialog widens.

interface SectionProps {
  platform: Platform;
  /** Whether it starts open. */
  open?: boolean;
}

/**
 * Which sections of help ember-rust gives: the browser's settings, but not for Safari or Chrome on an
 * iPhone or iPad, which have none; the system's, only in the installed app; and how to install Ember,
 * but not for Chrome, nor for Firefox but on Android, nor in the installed app.
 */
function useSections(platform: Platform) {
  const inBrowser = useMediaQuery("(display-mode: browser)");
  const installed = useMediaQuery("(display-mode: standalone)");
  return {
    browser: !((platform.safari || platform.chrome) && platform.ios),
    system: !inBrowser,
    install: givesInstallSteps(platform) && !installed,
  };
}

/** All the help ember-rust's Notification setup dialog gives, whose only section, if it has just one, starts open. */
export function NotificationHelp({ platform }: { platform: Platform }) {
  const sections = useSections(platform);
  const open = Object.values(sections).filter(Boolean).length === 1;
  return (
    <>
      {sections.browser && <BrowserSettings platform={platform} open={open} />}
      {sections.system && <SystemSettings platform={platform} open={open} />}
      {sections.install && <InstallSteps platform={platform} open={open} />}
    </>
  );
}

/** How to install Ember, where ember-rust's profile gives it, if it gives it to this browser. */
export function InstallInstructions({ platform }: { platform: Platform }) {
  return useSections(platform).install && <InstallSteps platform={platform} />;
}

/** Ruby's `String#capitalize`, as ember-rust names the browser: its first letter upper case, and the rest lower. */
const capitalize = ([first = "", ...rest]: string) => first.toUpperCase() + rest.join("").toLowerCase();

/** The address of Ember's home page, as ember-rust's `ctx.url("/")` writes it. */
const siteAddress = () => new URL("/", location.href).href;

function BrowserSettings({ platform, open }: SectionProps) {
  const browser = capitalize(platform.browser);
  const { firefox, chrome, safari, edge, android, desktop } = platform;
  return (
    <HelpSection icon={ExternalWeb} title={`Check your ${browser} settings`} open={open}>
      {firefox && android ? (
        <Steps>
          <li>
            Tap <Pictured icon={Lock} alt="the View site information button" size={20} /> in the address bar.
          </li>
          <li>
            Tap <em>Notification</em> to change to <em>Allowed</em>.
          </li>
        </Steps>
      ) : edge && desktop ? (
        <>
          <Heading>Turn on notifications for this website.</Heading>
          <Steps>
            <li>
              Click <Pictured icon={Lock} alt="the View site information button" size={20} /> left of the address bar.
            </li>
            <li>
              Under <em>Permissions for this site &gt; Notifications</em>, choose <em>Allow</em>.
            </li>
          </Steps>
          <Heading>Turn on notifications for {browser}.</Heading>
          <SystemSteps platform={platform} app={browser} windowsSwitch="the switch" macSwitch="the switch" />
        </>
      ) : firefox && desktop ? (
        <>
          <Heading>Turn on notifications for this website.</Heading>
          <Steps>
            <li>
              Click <em>{browser}</em> in the top left.
            </li>
            <li>
              Click <em>Settings…</em>.
            </li>
            <li>
              Click <em>Privacy & Security</em> in the sidebar.
            </li>
            <li>
              Scroll down to <em>Permissions</em>.
            </li>
            <li>
              Click <em>Settings</em> next to <em>Notifications</em>.
            </li>
            <li>
              Select <em>Allow</em> next to <em>{siteAddress()}</em>.
            </li>
          </Steps>
          <Heading>Turn on notifications for {browser}.</Heading>
          <SystemSteps platform={platform} app={browser} windowsSwitch="the toggle button" macSwitch="the switch" />
        </>
      ) : chrome && desktop ? (
        <>
          <Heading>Turn on notifications for this website.</Heading>
          <Steps>
            <li>
              Click the <Pictured icon={ExternalSliders} alt="View site information" size={20} /> icon in the address bar.
            </li>
            <li>
              Click <em>Site Settings</em>.
            </li>
            <li>
              Ensure notifications are <em>Allowed</em>.
            </li>
          </Steps>
          <Heading>Turn on notifications for {browser}.</Heading>
          <SystemSteps platform={platform} app={browser} windowsSwitch="the switch" macSwitch="the switch" />
        </>
      ) : chrome && android ? (
        <Steps>
          <li>
            Tap the <Pictured icon={MenuDotsVertical} alt="More options" size={16} /> menu button.
          </li>
          <li>
            Tap <em>Settings</em>.
          </li>
          <li>
            Tap <em>Notifications</em>.
          </li>
          <li>
            Tap <Pictured icon={ExternalSwitch} alt="the switch" size={22} /> to <em>Allow {browser} notifications</em>.
          </li>
          <li>
            Tap <Pictured icon={ExternalSwitch} alt="the switch" size={22} /> next to <em>Web apps</em>.
          </li>
          <li>
            Tap <Pictured icon={NotificationBellAlert} alt="the notification bell" size={16} /> and select <em>Allow</em>.
          </li>
        </Steps>
      ) : safari && desktop ? (
        <Steps>
          <li>
            Click <em>{browser}</em> in the top left.
          </li>
          <li>
            Click <em>Settings…</em>.
          </li>
          <li>
            Click the <em>Websites</em> tab.
          </li>
          <li>
            Click <em>Notifications</em> in the sidebar.
          </li>
          <li>
            Click <em>{siteAddress()}</em> in the list.
          </li>
          <li>
            Select <em>Allow</em>.
          </li>
        </Steps>
      ) : (
        <Paragraph>
          Ensure notifications are enabled for <em>{siteAddress()}</em> in your web browser settings.
        </Paragraph>
      )}
    </HelpSection>
  );
}

function SystemSettings({ platform, open }: SectionProps) {
  const browser = capitalize(platform.browser);
  const { firefox, chrome, safari, edge, android, ios, desktop } = platform;
  return (
    <HelpSection icon={ExternalGear} title={`Check your ${platform.operatingSystem} settings`} open={open}>
      {firefox && android ? (
        <Steps>
          <li>
            Tap the <Pictured icon={MenuDotsVertical} alt="More options" size={16} /> menu button.
          </li>
          <li>
            Tap <em>Settings</em>.
          </li>
          <li>
            Tap <em>Notifications</em>.
          </li>
          <li>
            Tap <Pictured icon={ExternalSwitch} alt="the toggle button" size={22} /> to <em>Allow {browser} notifications</em>.
          </li>
        </Steps>
      ) : edge && desktop ? (
        <SystemSteps platform={platform} app="Ember" windowsSwitch="the toggle button" macSwitch="the allow notifications switch" />
      ) : (firefox || chrome) && desktop ? (
        <SystemSteps platform={platform} app="Ember" windowsSwitch="the toggle button" macSwitch="the allow notifications switch" />
      ) : safari && desktop ? (
        <SystemSteps platform={platform} app="Ember" windowsSwitch="the toggle button" macSwitch="the allow notifications switch" />
      ) : (safari || chrome) && ios ? (
        <Steps>
          <li>
            Open the <Pictured icon={ExternalGear} size={20} /> Settings app.
          </li>
          <li>
            Scroll to and tap <em>Ember</em>.
          </li>
          <li>
            Tap <em>Notifications</em>.
          </li>
          <li>
            Tap <Pictured icon={ExternalSwitch} alt="the allow notifications switch button" size={22} /> to <em>Allow Notifications</em>.
          </li>
        </Steps>
      ) : chrome && android ? (
        <Steps>
          <li>
            Open the <Pictured icon={ExternalGear} size={20} /> Settings app.
          </li>
          <li>
            Tap <em>Notifications</em>.
          </li>
          <li>
            Tap <em>App notifications</em>.
          </li>
          <li>
            Scroll to <em>Ember</em>.
          </li>
          <li>
            Tap <Pictured icon={ExternalSwitch} alt="the switch" size={22} /> to <em>Allow Notifications</em>.
          </li>
        </Steps>
      ) : (
        <Paragraph>Ensure notifications are allowed for {browser} in your system settings.</Paragraph>
      )}
    </HelpSection>
  );
}

/**
 * ember-rust's steps for Chrome on Android never show, since Chrome gets no install steps, and Edge's run
 * its button into the next word, which these keep apart.
 */
function InstallSteps({ platform, open }: SectionProps) {
  const browser = capitalize(platform.browser);
  const { firefox, chrome, safari, edge, android, ios, desktop } = platform;
  return (
    <HelpSection icon={ExternalInstall} title="Install Ember as a web app." open={open}>
      {edge ? (
        <Steps>
          <li>
            Click <Pictured icon={InstallEdge} alt="the app available - install Ember chat button" size={16} /> in the address bar.
          </li>
          <li>
            Click <em>Install</em>.
          </li>
        </Steps>
      ) : firefox && android ? (
        <Steps>
          <li>
            Tap the <Pictured icon={MenuDotsVertical} alt="More options" size={16} /> menu button.
          </li>
          <li>
            Tap <em>Install</em> in the menu.
          </li>
        </Steps>
      ) : safari && desktop ? (
        <Steps>
          <li>
            Click <em>File</em> in the top left.
          </li>
          <li>
            Click <em>Add to Dock…</em>.
          </li>
        </Steps>
      ) : (safari || chrome) && ios ? (
        <>
          <Paragraph>
            To receive push notifications in {browser} for {platform.operatingSystem}, you must install Ember as a web app.
          </Paragraph>
          <Steps>
            <li>
              Tap <Pictured icon={ExternalShare} alt="the share button" size={20} />
            </li>
            <li>
              Tap <em>Add to Home Screen</em>.
            </li>
          </Steps>
        </>
      ) : (
        <Paragraph>Some platforms require you to install Ember as a web app to receive push notifications.</Paragraph>
      )}
      <InstallNow />
    </HelpSection>
  );
}

/**
 * Campfire's `.pwa__installer`: Install now, which shows the browser's prompt to install Ember once the
 * browser has offered to. It's ember-rust's ink button wherever it shows, where in the dialog the header's
 * styles make ember-rust's clear, its icon white on white.
 */
function InstallNow() {
  const installable = useSyncExternalStore(subscribeToInstallPrompt, canInstall);
  if (!installable) return null;
  return (
    <div className="mt-4 text-center">
      {/* Campfire's `.separator`, which a panel draws in its border color. */}
      <hr className="my-4 border-dashed border-border in-[dialog]:border-muted-foreground" />
      <button
        type="button"
        onClick={promptInstall}
        className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-foreground px-[1.1em] py-[0.5em] font-medium text-background touch:min-h-11"
      >
        <ExternalInstall tone="reversed" className="w-[1.3em]" />
        Install now
      </button>
    </div>
  );
}

interface SystemStepsProps {
  platform: Platform;
  /** Whose notifications to allow. */
  app: string;
  /** What ember-rust names the switch for them in Windows Settings, and in macOS's System Settings. */
  windowsSwitch: string;
  macSwitch: string;
}

/**
 * The steps to allow `app`'s notifications in Windows Settings or in macOS's System Settings. Other
 * systems, such as Linux and ChromeOS, get ember-rust's sentence for a system it has no steps for, where
 * ember-rust gives every desktop but Windows macOS's steps.
 */
function SystemSteps({ platform, app, windowsSwitch, macSwitch }: SystemStepsProps) {
  if (platform.windows)
    return (
      <Steps>
        <li>
          Click <em>Start</em>, then <em>Settings</em>.
        </li>
        <li>
          Go to <em>System &gt; Notification</em>.
        </li>
        <li>
          Click <Pictured icon={ExternalSwitch} alt={windowsSwitch} size={22} /> <em>ON</em> for {app}.
        </li>
      </Steps>
    );
  if (platform.operatingSystem !== "macOS")
    return <Paragraph>Ensure notifications are allowed for {capitalize(platform.browser)} in your system settings.</Paragraph>;
  return (
    <Steps>
      <li>
        {/* The Apple logo, in the private-use character Apple's fonts draw it as. ember-rust labels the `em`,
            which screen readers don't read, so this names it as a picture. */}
        Click{" "}
        <em role="img" aria-label="the Apple menu">
          {"\uF8FF"}
        </em>{" "}
        in the top left.
      </li>
      <li>
        Click <em>System Settings…</em>.
      </li>
      <li>
        Click <em>Notifications</em>.
      </li>
      <li>
        Click <em>{app}</em>.
      </li>
      <li>
        Click <Pictured icon={ExternalSwitch} alt={macSwitch} size={22} /> to <em>Allow notifications</em>.
      </li>
    </Steps>
  );
}

/** Campfire's `.notifications-help`: a box of steps under a summary that shows and hides them. */
function HelpSection({ icon: Icon, title, open = false, children }: { icon: ComponentType<CampfireIconProps>; title: string; open?: boolean; children: ReactNode }) {
  return (
    <details
      open={open}
      className="group mb-2 rounded-[0.5em] border bg-border px-[var(--inline-space,1ch)] py-4 [&_img]:inline [&_img]:align-text-top"
    >
      <summary className="-mx-[var(--inline-space,1ch)] -my-4 flex cursor-pointer list-none items-center gap-[0.5em] rounded-[0.5em] px-[var(--inline-space,1ch)] py-4 font-medium [&::-webkit-details-marker]:hidden">
        <Icon width={20} height={20} className="h-5 w-[1.3em]" />
        <strong>{title}</strong>
        <Disclosure width={10} height={10} className="ms-auto size-2.5 transition-transform duration-150 ease-[ease] group-open:rotate-90" />
      </summary>
      {children}
    </details>
  );
}

/** The box each picture in the steps is drawn in, as wide as it's tall, as ember-rust sizes them. */
const PICTURE_SIZES = { 16: "size-4", 20: "size-5", 22: "size-[22px]" };

/** A button or icon the steps show, in a step's emphasis, named by `alt` unless it only decorates. */
function Pictured({ icon: Icon, alt = "", size }: { icon: ComponentType<CampfireIconProps>; alt?: string; size: keyof typeof PICTURE_SIZES }) {
  return (
    <em>
      <Icon alt={alt} width={size} height={size} className={PICTURE_SIZES[size]} />
    </em>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="my-[1em] list-decimal ps-10 [&>li]:my-2">{children}</ol>;
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mt-4 text-base font-normal">{children}</h2>;
}

function Paragraph({ children }: { children: ReactNode }) {
  return <p className="my-[1em]">{children}</p>;
}
