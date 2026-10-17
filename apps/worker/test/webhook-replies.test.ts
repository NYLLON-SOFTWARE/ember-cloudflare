import { feature } from "@ember/parity";
import { MAX_MESSAGE_HTML_LENGTH } from "@ember/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentTypeOf, replyFileOf } from "../src/bots/mime";
import { postWebhook, WebhookError, type Delivered } from "../src/bots/webhooks";
import recorded from "./fixtures/webhook_cases.json";
import answers from "./fixtures/webhook_expected.json";

// What a delivery makes of a bot's answer, as Campfire's `Webhook#deliver` reads it
// (reference/app/models/webhook.rb) and ember-rust's integrations/webhook.rs follows it: the text or file
// the bot says back, or that it failed to respond. webhooks.test.ts checks what the room does with it.
//
// It replays the answers ember-rust recorded from the Rails app it ports (fixtures/README.md). Each is
// given as a Worker's `fetch` would give it, a gzipped body decompressed, and the delivery must come to
// what Campfire's did: the webhook's status and the bot's reply, or a failure. The request must be the
// one Net::HTTP sent, but for the headers a Worker's `fetch` decides itself. A file isn't read until bots
// can post files (plan 10.7), so only its name and type are compared.

interface Case {
  name: string;
  url?: string;
  status: number;
  headers: [string, string][];
  body?: string;
  body_b64?: string;
  gzip?: boolean;
  delay?: number;
}

interface Answer {
  name: string;
  status?: number | null;
  error?: string;
  reply: { text_b64: string } | { attachment: { filename: string; content_type: string } } | null;
  requests: { request_line: string; headers: [string, string][]; body: string }[];
}

const cases = recorded as Case[];

/** What the recording delivers to each webhook. */
const PAYLOAD = '{"message":"hi"}';

/** The headers Net::HTTP sends that a Worker's `fetch` decides itself. */
const FETCH_HEADERS = ["Accept-Encoding", "Host", "Connection", "Content-Length"];

/** What the reference raised, as this port fails with it. A Worker's `fetch` doesn't say why it couldn't connect, as Ruby's `Errno` does. */
const FAILURES: Record<string, (recorded: Case) => WebhookError> = {
  "Mime::Type::InvalidMimeType": ({ headers }) => new WebhookError(`${JSON.stringify(headers[0]![1])} is not a valid MIME type`),
  "Errno::ECONNREFUSED": () => new WebhookError("TypeError: Network connection lost."),
};

/** A request as a webhook gets it: its request line without the version, its headers by name, in lower case, and its body. */
interface Sent {
  line: string;
  headers: string[][];
  body: string;
}

/** Stands in for `fetch`, answering as the recorded webhook did, and keeps each request that reaches it. */
function webhookAnswering(recorded: Case) {
  const requests: Sent[] = [];
  const send = (async (input: URL, init: RequestInit) => {
    // Nothing listens where the refused case delivers.
    if (recorded.url) throw new TypeError("Network connection lost.");
    requests.push({ line: `${init.method} ${input.pathname}${input.search}`, headers: [...new Headers(init.headers)].sort(), body: init.body as string });
    if (recorded.delay) await answeredAfter(recorded.delay * 1000, init.signal!);
    const headers = new Headers(recorded.headers);
    if (recorded.gzip) headers.set("Content-Encoding", "gzip");
    return new Response(bodyOf(recorded), { status: recorded.status, headers });
  }) as typeof fetch;
  return { send, requests };
}

/** Waits `ms`, unless the request is given up on first, as a webhook that answers late does. */
const answeredAfter = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** The recorded body, as bytes, since a `Response` made with a string says it's `text/plain` when the webhook said nothing. */
const bodyOf = (recorded: Case) => (recorded.body_b64 === undefined ? new TextEncoder().encode(recorded.body ?? "") : bytesOf(recorded.body_b64));

/** The request the reference sent, but for the headers `fetch` decides. */
const sentBy = ({ request_line, headers, body }: Answer["requests"][number]): Sent => ({
  line: request_line.replace(/ HTTP\/1\.1$/, ""),
  headers: headers.filter(([name]) => !FETCH_HEADERS.includes(name)).map(([name, value]) => [name.toLowerCase(), value]).sort(),
  body,
});

/**
 * What the reference made of the answer, as a delivery here comes to it. Ruby keeps the invalid UTF-8
 * of a text reply as it came, which no JavaScript string can hold, so it's compared as a message here
 * keeps it, and ember-rust's does, with each invalid sequence replaced.
 */
function deliveredBy({ status, reply }: Answer): Delivered {
  if (reply === null) return { status: status ?? null, reply };
  if ("attachment" in reply) return { status: status ?? null, reply: { file: { filename: reply.attachment.filename, contentType: reply.attachment.content_type } } };
  return { status: status ?? null, reply: { text: new TextDecoder().decode(bytesOf(reply.text_b64)) } };
}

/** What a delivery to a webhook that `send` stands in for comes to. */
const deliveredTo = (send: typeof fetch) => postWebhook("https://bots.example.com/hook", "{}", { send });

/**
 * Stands in for a webhook that answers text a part at a time, each `everyMs` after the last, for `parts`
 * parts or for ever, until the request is given up on.
 */
const trickling = (everyMs: number, parts = Infinity) =>
  (async (_input: URL, init: RequestInit) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await answeredAfter(everyMs, init.signal!);
        if (sent === parts) controller.close();
        else controller.enqueue(new TextEncoder().encode(`${++sent} `));
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain" } });
  }) as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
});

describe(feature("bots.webhook-reply"), () => {
  it("replays every recorded case", () => {
    expect(cases.map(({ name }) => name)).toEqual((answers as Answer[]).map(({ name }) => name));
    expect(cases).toHaveLength(19);
  });

  it.each((answers as Answer[]).map((answer, index) => ({ ...answer, recorded: cases[index]! })))("$name", async ({ recorded, ...answer }) => {
    // Late answers wait on the clock, which the test moves on.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const webhook = webhookAnswering(recorded);
    const delivered = postWebhook(recorded.url ?? `http://bots.example.com/${recorded.name}`, PAYLOAD, { send: webhook.send });

    if (answer.error) {
      await expect(delivered).rejects.toThrow(FAILURES[answer.error]!(recorded));
    } else {
      if (recorded.delay) await vi.advanceTimersByTimeAsync(recorded.delay * 1000);
      expect(await delivered).toEqual(deliveredBy(answer));
    }
    expect(webhook.requests).toEqual(answer.requests.map(sentBy));
  });

  it("names a reply's file by its type as Rails' Mime::Type.lookup does, refusing a type that isn't a media type", () => {
    const fileFor = (header: string) => replyFileOf(contentTypeOf(header)!);
    expect(fileFor("image/jpeg")).toEqual({ filename: "attachment.jpeg", contentType: "image/jpeg" });
    expect(fileFor("application/x-gzip")).toEqual({ filename: "attachment.gzip", contentType: "application/gzip" });
    expect(fileFor("IMAGE/PNG")).toEqual({ filename: "attachment.", contentType: "IMAGE/PNG" });
    expect(fileFor("text/html; charset=utf-8")).toEqual({ filename: "attachment.html", contentType: "text/html" });
    expect(fileFor("video/quicktime")).toEqual({ filename: "attachment.", contentType: "video/quicktime" });
    for (const invalid of ["image", "", "text/html, text", "a/b c"]) expect(fileFor(invalid), invalid).toBeNull();
  });

  it("reads the media type of a Content-Type header as Net::HTTP does", () => {
    const noBreakSpace = String.fromCharCode(0xa0);
    expect(contentTypeOf(null)).toBeNull();
    expect(contentTypeOf("text/plain; charset=utf-8")).toBe("text/plain");
    expect(contentTypeOf(" text / plain ;")).toBe("text/plain");
    expect(contentTypeOf("Text/Plain")).toBe("Text/Plain");
    expect(contentTypeOf("image/png/extra")).toBe("image/png");
    expect(contentTypeOf("image")).toBe("image");
    expect(contentTypeOf("")).toBe("");
    // Ruby's whitespace is ASCII's, so a no-break space stays, and the type is no media type.
    expect(contentTypeOf(`text/plain${noBreakSpace}`)).toBe(`text/plain${noBreakSpace}`);
  });

  it("gives a webhook 7 seconds to send each part of its answer and a minute in all, then says it failed to respond", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const steady = deliveredTo(trickling(6_000, 3));
    await vi.advanceTimersByTimeAsync(24_000);
    expect(await steady).toEqual({ status: 200, reply: { text: "1 2 3 " } });

    const stalled = deliveredTo(trickling(8_000));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await stalled).toEqual({ status: null, reply: { text: "Failed to respond within 7 seconds" } });

    // ember-rust's deadline: one that keeps sending would otherwise hold its place in the queue for ever.
    const endless = deliveredTo(trickling(6_000));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await endless).toEqual({ status: null, reply: { text: "Failed to respond within 60 seconds" } });
  });

  it("fails a text reply longer than a message's markup can be, reading no further once it's over", async () => {
    const answering = (body: BodyInit) => deliveredTo((async () => new Response(body, { headers: { "Content-Type": "text/plain" } })) as typeof fetch);
    const longest = "x".repeat(MAX_MESSAGE_HTML_LENGTH);
    expect(await answering(longest)).toEqual({ status: 200, reply: { text: longest } });
    await expect(answering(`${longest}x`)).rejects.toThrow(new WebhookError("the reply is longer than a message can be"));

    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(65_536).fill(0x78)),
      cancel() {
        cancelled = true;
      },
    });
    await expect(answering(endless)).rejects.toThrow(new WebhookError("the reply is longer than a message can be"));
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
});

