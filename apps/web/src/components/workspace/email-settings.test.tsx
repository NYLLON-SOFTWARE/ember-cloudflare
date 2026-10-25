import { feature } from "@ember/parity";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANT_SEND_EMAIL, EMAIL_FROM_REFUSED, type Account, type AccountChanges, type EmailSettings as Email } from "@ember/protocol";
import { ApiError } from "@/lib/api";
import { EMAIL_SENDING_DASHBOARD, EmailSettings } from "./email-settings";

const EMBER: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, navigationIcons: {} };

interface Answers {
  /** What saving the From address answers, rather than the workspace. */
  saved?: () => Response | Promise<Response>;
  /** What Send me a test email answers, rather than where it went. */
  tested?: () => Response | Promise<Response>;
}

/** Answers the card's requests as the server would, or as `answers` says. */
function serve({ saved, tested }: Answers = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    switch (`${init?.method} ${String(input)}`) {
      case "PATCH /api/account":
        return saved ? saved() : Response.json({ account: EMBER });
      case "POST /api/account/test_email":
        return tested ? tested() : Response.json({ to: "ada@example.com" });
      default:
        throw new Error(`Unexpected request for ${init?.method} ${String(input)}`);
    }
  });
}

/** What the card asked to save, in order. */
const saved = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => (JSON.parse(String(init?.body)) as AccountChanges).emailFrom);

/** A response the test lets through when it says, with `answer` letting it through. */
function held(response: () => Response) {
  let answer = () => {};
  const answered = new Promise<Response>((resolve) => (answer = () => resolve(response())));
  return { answered: () => answered, answer: () => act(async () => answer()) };
}

/** The card, for a deployment that sends email as `email` says, keeping the From address as Membership does once it's saved. */
function showCard(email: Email) {
  const callbacks = { onAccountChanged: vi.fn(), onFromSaved: vi.fn(), onFailed: vi.fn() };
  function Card() {
    const [from, setFrom] = useState(email.from);
    const [askForAccount] = useState(() => () => callbacks.onAccountChanged);
    const fromSaved = (saved: string | null) => {
      callbacks.onFromSaved(saved);
      setFrom(saved);
    };
    return <EmailSettings email={{ ...email, from }} askForAccount={askForAccount} onFromSaved={fromSaved} onFailed={callbacks.onFailed} />;
  }
  render(<Card />);
  return { ...callbacks, user: userEvent.setup() };
}

const card = () => screen.getByRole("region", { name: "Email" });
const fromField = () => screen.getByRole("textbox", { name: "From" });
const testButton = () => screen.getByRole("button", { name: "Send me a test email" });

afterEach(() => vi.restoreAllMocks());

describe(feature("platform.email"), () => {
  it("says Ember sends with Cloudflare Email Service, and how to set it up until there's a From address", () => {
    serve();
    showCard({ provider: "cloudflare", from: null });
    expect(card()).toHaveTextContent("Ember sends email with Cloudflare Email Service.");
    expect(fromField()).toHaveValue("");
    expect(fromField()).toHaveAttribute("placeholder", "Ember <ember@example.com>");
    expect(fromField()).toHaveAccessibleDescription("The address Ember's email comes from, with a name before it if you like, on a domain onboarded to Email Sending.");
    expect(testButton()).toBeDisabled();

    const steps = screen.getByRole("list", { name: "Steps to send email with Cloudflare" });
    const [plan, domain, from] = within(steps).getAllByRole("listitem");
    expect(plan).toHaveTextContent("Put the Cloudflare account that runs Ember on the Workers Paid plan. On Workers Free, Cloudflare sends only to the account's own verified addresses.");
    expect(domain).toHaveTextContent("In the Cloudflare dashboard, open Email Service, Email Sending, choose Onboard Domain, and pick a domain on Cloudflare DNS.");
    expect(within(domain!).getByRole("link", { name: "Open Email Sending in the Cloudflare dashboard" })).toHaveAttribute("href", EMAIL_SENDING_DASHBOARD);
    expect(from).toHaveTextContent("Give a From address on that domain above, save it, and send yourself a test email.");
    expect(card()).toHaveTextContent("Or send with Resend, which works on Workers Free: verify the domain in Resend, then give this Worker a Resend API key as the secret RESEND_API_KEY.");
  });

  it("says Ember sends with Resend while the deployment has its API key, with Resend's steps", () => {
    serve();
    showCard({ provider: "resend", from: null });
    expect(card()).toHaveTextContent("Ember sends email with Resend, with the API key in RESEND_API_KEY.");
    expect(fromField()).toHaveAccessibleDescription("The address Ember's email comes from, with a name before it if you like, on a domain verified in Resend.");
    const steps = screen.getByRole("list", { name: "Steps to send email with Resend" });
    const [domain, from] = within(steps).getAllByRole("listitem");
    expect(domain).toHaveTextContent("In Resend, add the domain to send from under Domains, and add the DNS records it asks for until it's verified.");
    expect(within(domain!).getByRole("link", { name: "Open Resend's domains" })).toHaveAttribute("href", "https://resend.com/domains");
    expect(from).toHaveTextContent("Give a From address on that domain above, save it, and send yourself a test email.");
    expect(screen.queryByRole("list", { name: "Steps to send email with Cloudflare" })).not.toBeInTheDocument();
  });

  it("says Ember can't send email yet, and offers no test email, even with a From address", () => {
    serve();
    showCard({ provider: null, from: "chat@example.com" });
    expect(card()).toHaveTextContent(CANT_SEND_EMAIL);
    expect(fromField()).toHaveValue("chat@example.com");
    expect(testButton()).toBeDisabled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("saves the From address as an address is written, then offers a test email", async () => {
    serve();
    const { user, onAccountChanged, onFromSaved } = showCard({ provider: "cloudflare", from: null });
    await user.type(fromField(), "  Ember Team   <chat@example.com> ");
    expect(testButton()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saved()).toEqual(["Ember Team <chat@example.com>"]);
    expect(onAccountChanged).toHaveBeenCalledWith(EMBER);
    expect(onFromSaved).toHaveBeenCalledWith("Ember Team <chat@example.com>");
    expect(fromField()).toHaveValue("Ember Team <chat@example.com>");
    expect(testButton()).toBeEnabled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("refuses a From address that isn't one, without saving it, until it's typed again", async () => {
    serve();
    const { user, onFromSaved } = showCard({ provider: "cloudflare", from: null });
    await user.type(fromField(), "Ember");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(EMAIL_FROM_REFUSED);
    expect(fromField()).toHaveAttribute("aria-invalid", "true");
    expect(fromField()).toHaveAccessibleDescription(EMAIL_FROM_REFUSED);
    expect(saved()).toEqual([]);
    expect(onFromSaved).not.toHaveBeenCalled();

    await user.type(fromField(), " <ember@example.com>");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fromField()).toHaveAttribute("aria-invalid", "false");
  });

  it("takes the From address away when it's saved empty, and says how to set sending up again", async () => {
    serve();
    const { user, onFromSaved } = showCard({ provider: "cloudflare", from: "chat@example.com" });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await user.clear(fromField());
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved()).toEqual([null]);
    expect(onFromSaved).toHaveBeenCalledWith(null);
    expect(testButton()).toBeDisabled();
    expect(screen.getByRole("list", { name: "Steps to send email with Cloudflare" })).toBeInTheDocument();
  });

  it("offers a test email only for the From address as it's saved", async () => {
    serve();
    const { user } = showCard({ provider: "cloudflare", from: "chat@example.com" });
    expect(testButton()).toBeEnabled();
    await user.type(fromField(), "x");
    expect(testButton()).toBeDisabled();
    await user.clear(fromField());
    await user.type(fromField(), " chat@example.com ");
    expect(testButton()).toBeEnabled();
  });

  it("sends a test email, and says where it went", async () => {
    const answer = held(() => Response.json({ to: "ada@example.com" }));
    serve({ tested: answer.answered });
    const { user } = showCard({ provider: "resend", from: "Ember <ember@example.com>" });
    await user.click(testButton());
    expect(screen.getByRole("status")).toHaveTextContent("Sending a test email…");
    expect(testButton()).toBeDisabled();

    await answer.answer();
    expect(screen.getByRole("status")).toHaveTextContent("Sent to ada@example.com. If it isn't in your inbox, look in spam.");
    expect(testButton()).toBeEnabled();
  });

  it("clears what a test email came to when the From address is saved, but not a test email still sending", async () => {
    const answer = held(() => Response.json({ to: "ada@example.com" }));
    serve({ tested: answer.answered });
    const { user, onFromSaved } = showCard({ provider: "cloudflare", from: "chat@example.com" });
    await user.click(testButton());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onFromSaved).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Sending a test email…");
    expect(testButton()).toBeDisabled();

    await answer.answer();
    expect(screen.getByRole("status")).toHaveTextContent("Sent to ada@example.com. If it isn't in your inbox, look in spam.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onFromSaved).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(saved()).toEqual(["chat@example.com", "chat@example.com"]);
  });

  it.each([
    [502, "Resend refused it: The example.com domain is not verified."],
    [503, CANT_SEND_EMAIL],
    [422, "Give Ember a From address first."],
  ])("says why the test email wasn't sent when the server answers %i", async (status, error) => {
    serve({ tested: () => Response.json({ error }, { status }) });
    const { user, onFailed } = showCard({ provider: "resend", from: "Ember <ember@example.com>" });
    await user.click(testButton());
    expect(await screen.findByText(error, { selector: "[role=status]" })).toBeInTheDocument();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("leaves a test email that failed for another reason, or a save that failed, to the page's alerts", async () => {
    serve({ tested: () => Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }), saved: () => Response.json({ error: "Not signed in" }, { status: 401 }) });
    const { user, onFailed, onFromSaved } = showCard({ provider: "cloudflare", from: "chat@example.com" });
    await user.click(testButton());
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(new ApiError(403, "Only administrators can change the workspace")));
    expect(screen.getByRole("status")).toHaveTextContent("");

    await user.type(fromField(), "x");
    await user.clear(fromField());
    await user.type(fromField(), "ember@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onFailed).toHaveBeenLastCalledWith(new ApiError(401, "Not signed in")));
    expect(onFromSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(fromField()).toHaveValue("ember@example.com");
  });
});
