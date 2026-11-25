import { describe, expect, it } from "vitest";
import type { Boost, User } from "@ember/protocol";
import { groupBoosts } from "./message-boosts";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };
const boost = (id: string, booster: User, content: string): Boost => ({ id, messageId: "m1", booster, content, createdAt: "" });

describe("groupBoosts", () => {
  it("gathers boosts by what they say, in the order each was first added", () => {
    const boosts = [boost("b1", grace, "👍"), boost("b2", ada, "🎉"), boost("b3", ada, "👍")];
    expect(groupBoosts(boosts)).toEqual([
      { content: "👍", boosts: [boosts[0], boosts[2]] },
      { content: "🎉", boosts: [boosts[1]] },
    ]);
  });

  it("keeps a reaction someone added twice, as a bot can", () => {
    const boosts = [boost("b1", ada, "👍"), boost("b2", ada, "👍")];
    expect(groupBoosts(boosts)).toEqual([{ content: "👍", boosts }]);
  });

  it("tells words apart by case, as the room does", () => {
    expect(groupBoosts([boost("b1", ada, "Nice"), boost("b2", grace, "nice")]).map((group) => group.content)).toEqual(["Nice", "nice"]);
  });
});
