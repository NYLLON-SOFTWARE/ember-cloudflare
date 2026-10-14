import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { prepareBody } from "./body";
import { mentionedUsers, userGid, userIdFromGid, userIdsIn } from "./mentions";
import { parseHtml } from "./parse";

const users = new Map([
  [1, { id: 1, name: "David" }],
  [2, { id: 2, name: "Jason" }],
]);
const resolve = (sgid: string) => users.get(userIdFromGid(sgid) ?? 0);
const mention = (id: number) => `<action-text-attachment content-type="application/vnd.campfire.mention" sgid="${userGid(id)}"></action-text-attachment>`;
const contentAttachment = (content: string) =>
  `<action-text-attachment content-type="text/html" content="${content.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></action-text-attachment>`;

describe(feature("mentions.render"), () => {
  it("names users by their global ids", () => {
    expect(userGid(42)).toBe("gid://ember/User/42");
    expect(userIdFromGid("gid://ember/User/42")).toBe(42);
    for (const sgid of ["gid://ember/User/042", "gid://ember/User/0", "gid://ember/Room/1", "gid://campfire/User/1", " gid://ember/User/1", "gid://ember/User/99999999999999999"]) {
      expect(userIdFromGid(sgid), sgid).toBeUndefined();
    }
  });

  it("finds the users a body mentions, once each and in order", () => {
    const body = `<p>${mention(2)} and ${mention(1)} and ${mention(2)} and ${mention(3)}</p>`;
    expect(mentionedUsers(parseHtml, body, resolve).map((user) => user.id)).toEqual([2, 1]);
    expect(mentionedUsers(parseHtml, "<p>Nobody</p>", resolve)).toEqual([]);
  });

  it("lists every user a body's attachments name, to look up, nested ones included", () => {
    expect(userIdsIn(parseHtml, `<p>${mention(2)}${mention(2)}${contentAttachment(mention(7))}</p>`)).toEqual([2, 7]);
    expect(userIdsIn(parseHtml, "<p>gid://ember/User/9 <a href='gid://ember/User/9'>x</a></p>")).toEqual([]);
  });

  it("reads the users' ids as the parser does, character references and all", () => {
    const encoded = (id: number) => `<action-text-attachment sgid="&#103;id&colon;//ember/User/${id}"></action-text-attachment>`;
    expect(userIdsIn(parseHtml, `${encoded(5)}${contentAttachment(encoded(6))}`)).toEqual([5, 6]);
    const body = `<p>Hi ${encoded(1)}</p>`;
    const found = new Map(userIdsIn(parseHtml, body).map((id) => [id, users.get(id)]));
    expect(prepareBody(parseHtml, body, (sgid) => found.get(userIdFromGid(sgid) ?? 0))?.mentions).toEqual([1]);
  });

  it("lists the users of content attachments as deep as they render", () => {
    let body = "";
    for (let level = 9; level >= 0; level--) body = level === 0 ? `${mention(100)}${body}` : contentAttachment(`${mention(100 + level)}${body}`);
    expect(userIdsIn(parseHtml, body)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108]);
    const resolved = new Set<number>();
    prepareBody(parseHtml, body, (sgid) => void resolved.add(userIdFromGid(sgid)!));
    expect([...resolved]).toEqual(userIdsIn(parseHtml, body));
  });

  it("skips what's past the parser's limits", () => {
    expect(userIdsIn(parseHtml, `${mention(1)}${"<b>".repeat(401)}`)).toEqual([]);
    expect(userIdsIn(parseHtml, `${mention(1)}${contentAttachment(`${mention(2)}${"<b>".repeat(401)}`)}`)).toEqual([1]);
  });
});
