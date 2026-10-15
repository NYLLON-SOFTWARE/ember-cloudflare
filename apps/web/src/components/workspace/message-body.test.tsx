import { feature } from "@ember/parity";
import { avatarSvg, type DirectoryUser, type User } from "@ember/protocol";
import { displayBody } from "@ember/richtext/dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { MessageBody } from "./message-body";

afterEach(() => history.replaceState(null, "", "/"));

/** Shows a stored body as a message shows it, returning its content. */
function show(html: string, trailing?: ReactNode) {
  const { container } = render(<MessageBody nodes={displayBody(html)} mentions={[]} trailing={trailing} />);
  return container.querySelector(".message-content")!;
}

/** Waits for highlight.js to load and highlight the code block shown last. */
async function highlighted(content: Element) {
  await vi.waitFor(() => expect(content.querySelector("pre:last-of-type [class^=hljs-]")).not.toBeNull());
}

describe(feature("messages.rich-text"), () => {
  it("shows the formatting a message keeps", () => {
    const body = [
      "<p><strong>Bold</strong> <em>italic</em> <s>struck</s> <u>underlined</u> <mark>marked</mark> <code>code</code></p>",
      "<h1>Title</h1><h2>Section</h2>",
      "<blockquote><p>Quoted</p><cite>Ada</cite></blockquote>",
      "<ol><li>First</li><li>Second</li></ol>",
      "<hr>",
      '<p><time datetime="2026-10-14">Today</time> <abbr title="HyperText Markup Language">HTML</abbr></p>',
      "<table><tbody><tr><th>Name</th></tr><tr><td>Ada</td></tr></tbody></table>",
    ].join("");
    expect(show(body).innerHTML).toBe(body);
  });

  it("leaves out the whitespace between a table's rows and cells, which no browser shows", () => {
    expect(show("<table>\n  <tbody>\n    <tr>\n      <td>Ada</td>\n    </tr>\n  </tbody>\n</table>").innerHTML).toBe(
      "<table><tbody><tr><td>Ada</td></tr></tbody></table>",
    );
  });

  it("shows no marker for a list item that only holds a list, as Lexxy nests lists", () => {
    const content = show("<ul><li>One</li><li><ul><li>Nested</li></ul></li></ul>");
    const [one, holder, nested] = content.querySelectorAll("li");
    expect(one).not.toHaveAttribute("data-list");
    expect(holder).toHaveAttribute("data-list", "true");
    expect(nested).not.toHaveAttribute("data-list");
  });

  it("builds the message itself rather than setting markup on the page", () => {
    const nodes = displayBody('<p>Hi <img src="x" onerror="alert(1)"> <a href="https://example.com">there</a></p><pre>puts 1</pre>');
    const setInnerHtml = vi.spyOn(Element.prototype, "innerHTML", "set");
    render(<MessageBody nodes={nodes} mentions={[]} />);
    expect(setInnerHtml.mock.contexts.filter((element) => (element as Element).ownerDocument === document)).toEqual([]);
    expect(document.querySelector("img")).toBeNull();
  });

  it("highlights a code block in the language it names", async () => {
    const content = show('<pre data-language="ruby">def greet = puts "Hi"</pre>');
    await highlighted(content);
    expect(content.querySelector(".hljs-keyword")).toHaveTextContent("def");
    expect(content.querySelector(".hljs-string")).toHaveTextContent('"Hi"');
    expect(content.querySelector("pre")).toHaveTextContent('def greet = puts "Hi"');
  });

  it("highlights a code block in whichever language fits best when it names none it knows", async () => {
    const content = show('<pre data-language="cobol">SELECT name FROM users WHERE id = 1;</pre>');
    await highlighted(content);
    expect(content.querySelector(".hljs-keyword")).toHaveTextContent("SELECT");
  });

  it("highlights a code block's lines, read from its line breaks", async () => {
    const content = show('<pre data-language="javascript">const a = 1;<br>const b = 2;</pre>');
    await highlighted(content);
    expect(content.querySelector("pre")!.textContent).toBe("const a = 1;\nconst b = 2;");
    expect(content.querySelectorAll(".hljs-keyword")).toHaveLength(2);
  });

  it("highlights neither inline code nor a code block with a link in it", async () => {
    const content = show('<p><code>const a = 1;</code></p><pre>See https://example.com</pre><pre data-language="javascript">const b = 2;</pre>');
    await highlighted(content);
    expect(content.querySelector("code [class^=hljs-]")).toBeNull();
    expect(content.querySelector("pre")!.innerHTML).toBe('See <a href="https://example.com" target="_blank" rel="noopener">https://example.com</a>');
  });

  it("puts what follows a message in its last paragraph", () => {
    expect(show("<p>One</p><p>Two</p>", <span>(edited)</span>).innerHTML).toBe("<p>One</p><p>Two <span>(edited)</span></p>");
    expect(show("<ul><li>One</li></ul>", <span>(edited)</span>).innerHTML).toBe("<ul><li>One</li></ul><span>(edited)</span>");
  });
});

const grace: DirectoryUser = { id: "0123456789abcdef", name: "Grace Hopper", bio: null, role: "member", status: "active", avatarUrl: "/users/g.abc/avatar?v=1" };

/** Shows a message mentioning Grace with the directory listing `people`, the message having named whom it mentions as `mentions` does. */
function mention(people: People, mentions: User[]) {
  const body = `<p>Hi <action-text-attachment content-type="application/vnd.campfire.mention" sgid="${grace.id}"></action-text-attachment>!</p>`;
  const { container } = render(
    <PeopleContext value={people}>
      <MessageBody nodes={displayBody(body)} mentions={mentions} />
    </PeopleContext>,
  );
  return container.querySelector(".message-content")!;
}

describe(feature("mentions.render"), () => {
  it("shows the person's avatar, hidden from screen readers, then their name as the directory lists them now", () => {
    const content = mention(new Map([[grace.id, grace]]), [{ id: grace.id, name: "Grace" }]);
    expect(content).toHaveTextContent("Hi Grace Hopper!");
    const avatar = content.querySelector("p > span > a > img")!;
    expect(avatar).toHaveAttribute("src", grace.avatarUrl);
    expect(avatar).toHaveAttribute("aria-hidden", "true");
  });

  it("names someone the directory doesn't list yet as the message did, by their initials", () => {
    const content = mention(new Map(), [{ id: grace.id, name: "Grace" }]);
    expect(content).toHaveTextContent("Hi Grace!");
    expect(content.querySelector("img")).toHaveAttribute("src", `data:image/svg+xml;base64,${btoa(avatarSvg(grace.id, "Grace"))}`);
  });

  it("shows ☒ for someone no one knows, as a message from before messages named the people they mention doesn't", () => {
    expect(mention(new Map(), []).innerHTML).toBe("<p>Hi ☒!</p>");
    expect(mention(new Map(), [{ id: grace.id, name: "" }]).innerHTML).toBe("<p>Hi ☒!</p>");
  });
});

describe(feature("users.avatar-links"), () => {
  it("links a mention's avatar to the person's page, titled with their name and bio, and follows it in place", async () => {
    const content = mention(new Map([[grace.id, { ...grace, bio: "Wrote the first compiler" }]]), [{ id: grace.id, name: "Grace" }]);
    const link = screen.getByRole("link", { name: "Grace Hopper – Wrote the first compiler" });
    expect(content.querySelector("p > span > a")).toBe(link);
    expect(link).toHaveAttribute("href", `/users/${grace.id}`);
    await userEvent.click(link);
    expect(location.pathname).toBe(`/users/${grace.id}`);
  });

  it("links the avatar of someone the directory doesn't list yet, titled with the name the message gave", () => {
    mention(new Map(), [{ id: grace.id, name: "Grace" }]);
    expect(screen.getByRole("link", { name: "Grace" })).toHaveAttribute("href", `/users/${grace.id}`);
  });
});

describe(feature("messages.autolink"), () => {
  it("opens a link to another site in a new tab", () => {
    show("<p>See https://example.com/docs?page=2.</p>");
    const link = screen.getByRole("link", { name: "https://example.com/docs?page=2" });
    expect(link).toHaveAttribute("href", "https://example.com/docs?page=2");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("opens a link to one of the app's pages in place", async () => {
    show(`<p>Over in ${location.origin}/rooms/r2?ref=x#m1</p>`);
    const link = screen.getByRole("link");
    expect(link).not.toHaveAttribute("target");
    const length = history.length;
    await userEvent.click(link);
    expect(location.pathname + location.search + location.hash).toBe("/rooms/r2?ref=x#m1");
    expect(history.length).toBe(length + 1);
  });

  it("leaves a link to another address on this site to the browser, in the same tab", () => {
    show(`<p>${location.origin}/qr_code/abc</p>`);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `${location.origin}/qr_code/abc`);
    expect(link).not.toHaveAttribute("target");
  });

  it("opens a link in a new tab when its address only starts like this site's", () => {
    // Another port, which Campfire's check, whether the address starts with this site's, takes for this site.
    const lookalike = `${location.origin}1/rooms/r2`;
    expect(new URL(lookalike).origin).not.toBe(location.origin);
    show(`<p>${lookalike}</p>`);
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });
});
