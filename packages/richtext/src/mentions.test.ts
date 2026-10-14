import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { mentionedUsers, userGid, userIdFromGid, userIdsIn } from "./mentions";
import { parseHtml } from "./parse";

const users = new Map([
  [1, { id: 1, name: "David" }],
  [2, { id: 2, name: "Jason" }],
]);
const resolve = (sgid: string) => users.get(userIdFromGid(sgid) ?? 0);
const mention = (id: number) => `<action-text-attachment content-type="application/vnd.campfire.mention" sgid="${userGid(id)}"></action-text-attachment>`;

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

  it("lists every user id in a body to look up, nested ones included", () => {
    const nested = `<action-text-attachment content-type="text/html" content="${mention(7).replaceAll('"', "&quot;")}"></action-text-attachment>`;
    expect(userIdsIn(`<p>${mention(2)}${mention(2)}${nested}</p>`)).toEqual([2, 7]);
  });
});
