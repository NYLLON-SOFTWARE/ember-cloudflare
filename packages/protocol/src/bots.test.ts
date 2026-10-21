import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { botMessagesPath, MAX_WEBHOOK_URL_LENGTH, parseBotChanges, parseNewBot } from "./bots";
import { MAX_USER_NAME_LENGTH } from "./index";

describe(feature("bots.create-edit"), () => {
  it("takes the name as typed and the webhook URL trimmed, leaving out what isn't sent", () => {
    expect(parseBotChanges({ name: " Build Bot ", webhookUrl: " https://ci.example.com/hook\n" })).toEqual({ name: " Build Bot ", webhookUrl: "https://ci.example.com/hook" });
    expect(parseBotChanges({ webhookUrl: "  " })).toEqual({ webhookUrl: "" });
    expect(parseBotChanges({ name: "Build Bot", avatar: "" })).toEqual({ name: "Build Bot" });
    expect(parseBotChanges({})).toEqual({});
  });

  it("takes a new bot with a name, with or without a webhook URL", () => {
    expect(parseNewBot({ name: "Build Bot" })).toEqual({ name: "Build Bot" });
    expect(parseNewBot({ name: "Build Bot", webhookUrl: "" })).toEqual({ name: "Build Bot", webhookUrl: "" });
  });

  it("takes a webhook URL as long as the server keeps", () => {
    const longest = `https://ci.example.com/${"a".repeat(MAX_WEBHOOK_URL_LENGTH - 23)}`;
    expect(parseBotChanges({ webhookUrl: longest })).toEqual({ webhookUrl: longest });
    expect(parseBotChanges({ webhookUrl: `${longest}a` })).toBe("Webhook URL can't be longer than 2048 characters");
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["a list", [{ name: "Build Bot" }], "Expected a JSON object"],
    ["a name that isn't text", { name: 7 }, "Name must be text"],
    ["a blank name", { name: " \t" }, "Name can't be blank"],
    ["a name longer than a person's can be", { name: "x".repeat(MAX_USER_NAME_LENGTH + 1) }, "Name can't be longer than 100 characters"],
    ["a webhook URL that isn't text", { name: "Build Bot", webhookUrl: null }, "Webhook URL must be text"],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseBotChanges(body)).toBe(error);
    expect(parseNewBot(body)).toBe(error);
  });

  it("refuses a new bot without a name", () => {
    expect(parseNewBot({})).toBe("Name can't be blank");
    expect(parseNewBot({ webhookUrl: "https://ci.example.com/hook" })).toBe("Name can't be blank");
  });
});

describe(feature("bots.list"), () => {
  it("puts where a bot posts to a room at the room's address, then the bot's key", () => {
    expect(botMessagesPath("0mgk3x2a9b4c5a", "0mgk3x2a9b4c5e-Ab3dEf5hiJ7k")).toBe("/rooms/0mgk3x2a9b4c5a/0mgk3x2a9b4c5e-Ab3dEf5hiJ7k/messages");
    expect(botMessagesPath("café", "1-a")).toBe("/rooms/caf%C3%A9/1-a/messages");
  });
});
