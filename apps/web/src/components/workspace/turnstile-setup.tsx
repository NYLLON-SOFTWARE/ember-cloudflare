// How to give the deployment Turnstile's keys, which the ways to join whose limits stand in for its
// check say, as Membership's notes end.

/** Where Turnstile's widgets are made, in the Cloudflare dashboard. */
const TURNSTILE_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/turnstile";

/** The steps to give this Worker Turnstile's keys, with a link to make its widget. */
export function TurnstileSetup() {
  return (
    <>
      add a Turnstile widget for Ember's address in the Cloudflare dashboard, then give this Worker its site key and secret key as the secrets{" "}
      <code>TURNSTILE_SITE_KEY</code> and <code>TURNSTILE_SECRET_KEY</code>.{" "}
      <a href={TURNSTILE_DASHBOARD} target="_blank" rel="noopener" className="underline">
        Open Turnstile in the Cloudflare dashboard
      </a>
    </>
  );
}
