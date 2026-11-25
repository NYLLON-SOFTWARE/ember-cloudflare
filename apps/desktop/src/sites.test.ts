import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sites } from "./sites.ts";

describe("Sites", () => {
  let folder: string;
  let file: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "ember-desktop-"));
    file = path.join(folder, "Ember", "sites.json");
  });

  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  it("starts with none, and keeps those added, changed and removed for the next start", () => {
    const sites = new Sites(file);
    expect(sites.list()).toEqual([]);

    const fernwood = sites.add("https://chat.example.com", "Fernwood");
    const other = sites.add("http://localhost:8787", "Ember");
    sites.update(fernwood.id, { bounds: { x: 10, y: 20, width: 1200, height: 800 }, open: true });
    sites.remove(other.id);

    const again = new Sites(file);
    expect(again.list()).toEqual([{ id: fernwood.id, address: "https://chat.example.com", name: "Fernwood", bounds: { x: 10, y: 20, width: 1200, height: 800 }, open: true }]);
    expect(again.at("https://chat.example.com")?.id).toBe(fernwood.id);
    expect(again.find(fernwood.id)?.name).toBe("Fernwood");
    expect(fs.readdirSync(path.dirname(file))).toEqual(["sites.json"]);
  });

  it("tells its listeners of each change", () => {
    const sites = new Sites(file);
    const listener = vi.fn();
    sites.onChange(listener);
    const site = sites.add("https://chat.example.com", "Fernwood");
    sites.update(site.id, { name: "Fernwood Co-op" });
    sites.remove(site.id);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("leaves out what it can't read: a damaged file, or a site with an address it wouldn't open", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    expect(new Sites(file).list()).toEqual([]);

    const kept = { id: "a", address: "https://chat.example.com", name: "Fernwood" };
    const sites = [kept, { id: "b", address: "http://chat.example.com", name: "Insecure" }, { id: "c", address: "https://chat.example.com/rooms", name: "A page" }, { id: "d", name: "Nowhere" }, null];
    fs.writeFileSync(file, JSON.stringify({ sites }));
    expect(new Sites(file).list()).toEqual([kept]);
  });
});
