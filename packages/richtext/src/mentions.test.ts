import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { prepareBody } from "./body";
import { mentionedUsers, mentionSgid, userIdFromSgid, userIdsIn } from "./mentions";
import { parseHtml } from "./parse";
import { testUserId as id, testUsers } from "./testing/users";

const { users, resolve } = testUsers("David", "Jason");
const mention = (n: number) => `<action-text-attachment content-type="application/vnd.campfire.mention" sgid="${mentionSgid(id(n))}"></action-text-attachment>`;
const contentAttachment = (content: string) =>
  `<action-text-attachment content-type="text/html" content="${content.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></action-text-attachment>`;

describe(feature("mentions.render"), () => {
  it("names users by their ids, which Lexxy keeps where it drops anything shaped like a URL", () => {
    expect(mentionSgid("0mgx5k2p9abc1234")).toBe("0mgx5k2p9abc1234");
    expect(userIdFromSgid("0mgx5k2p9abc1234")).toBe("0mgx5k2p9abc1234");
    for (const sgid of ["gid://ember/User/0mgx5k2p9abc1234", "0MGX5K2P9ABC1234", "0mgx5k2p9abc123", "0mgx5k2p9abc12345", " 0mgx5k2p9abc1234", "0mgx5k2p9abc-234", ""]) {
      expect(userIdFromSgid(sgid), sgid).toBeUndefined();
    }
  });

  it("finds the users a body mentions, once each and in order", () => {
    const body = `<p>${mention(2)} and ${mention(1)} and ${mention(2)} and ${mention(3)}</p>`;
    expect(mentionedUsers(parseHtml, body, resolve).map((user) => user.id)).toEqual([id(2), id(1)]);
    expect(mentionedUsers(parseHtml, "<p>Nobody</p>", resolve)).toEqual([]);
  });

  it("lists every user a body's attachments name, to look up, nested ones included", () => {
    expect(userIdsIn(parseHtml, `<p>${mention(2)}${mention(2)}${contentAttachment(mention(7))}</p>`)).toEqual([id(2), id(7)]);
    expect(userIdsIn(parseHtml, `<p>${id(9)} <a href="${id(9)}">x</a></p>`)).toEqual([]);
  });

  it("reads the users' ids as the parser does, character references and all", () => {
    // The first character, written as a reference
    const encoded = (n: number) => `<action-text-attachment sgid="&#${id(n).charCodeAt(0)};${id(n).slice(1)}"></action-text-attachment>`;
    expect(userIdsIn(parseHtml, `${encoded(5)}${contentAttachment(encoded(6))}`)).toEqual([id(5), id(6)]);
    const body = `<p>Hi ${encoded(1)}</p>`;
    const found = new Map(userIdsIn(parseHtml, body).map((userId) => [userId, users.get(userId)]));
    expect(prepareBody(parseHtml, body, (sgid) => found.get(userIdFromSgid(sgid) ?? ""))?.mentions).toEqual([id(1)]);
  });

  it("lists the users of content attachments as deep as they render", () => {
    let body = "";
    for (let level = 9; level >= 0; level--) body = level === 0 ? `${mention(100)}${body}` : contentAttachment(`${mention(100 + level)}${body}`);
    expect(userIdsIn(parseHtml, body)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108].map(id));
    const resolved = new Set<string>();
    prepareBody(parseHtml, body, (sgid) => void resolved.add(userIdFromSgid(sgid)!));
    expect([...resolved]).toEqual(userIdsIn(parseHtml, body));
  });

  it("skips what's past the parser's limits", () => {
    expect(userIdsIn(parseHtml, `${mention(1)}${"<b>".repeat(401)}`)).toEqual([]);
    expect(userIdsIn(parseHtml, `${mention(1)}${contentAttachment(`${mention(2)}${"<b>".repeat(401)}`)}`)).toEqual([id(1)]);
  });
});
