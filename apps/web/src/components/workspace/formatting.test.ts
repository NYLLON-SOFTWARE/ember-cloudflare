import { describe, expect, it } from "vitest";
import { linkAddress } from "./formatting";

describe("linkAddress", () => {
  it("gives an address without a scheme https://, and keeps a web, mail or phone one", () => {
    expect(linkAddress(" example.com/a ")).toBe("https://example.com/a");
    expect(linkAddress("http://localhost:5173")).toBe("http://localhost:5173");
    expect(linkAddress("localhost:3000/x")).toBe("https://localhost:3000/x");
    expect(linkAddress("example.com:8080")).toBe("https://example.com:8080");
    expect(linkAddress("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(linkAddress("tel:+15550100")).toBe("tel:+15550100");
  });

  it("refuses words, which aren't an address, and what isn't a web, mail or phone one", () => {
    expect(linkAddress("not a url")).toBeNull();
    expect(linkAddress("example")).toBeNull();
    expect(linkAddress("")).toBeNull();
    expect(linkAddress("javascript:alert(1)")).toBeNull();
  });
});
