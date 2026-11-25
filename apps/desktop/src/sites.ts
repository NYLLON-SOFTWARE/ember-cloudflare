import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { siteAddressOf } from "./site-address.ts";

/** Where a window is on the screen. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An Ember site added to the app. */
export interface Site {
  /** Made up as it's added, naming where its window keeps its sign-in, apart from every other site's. */
  id: string;
  /** Its origin, which its pages open at. */
  address: string;
  /** Its workspace's name, as the Sites menu lists it. */
  name: string;
  /** Where its window was last, to open it there again. */
  bounds?: Bounds;
  /** Whether its window, or one its pages opened, was open as the app last quit, to open it again as the app starts. */
  open?: boolean;
}

/** What can change of a site once it's added. */
export type SiteChanges = Partial<Omit<Site, "id">>;

/**
 * The sites added to the app, in the order they were added, kept in a JSON file in the app's own folder,
 * which is written whole to a file beside it first, so a crash never leaves half of it.
 */
export class Sites {
  #sites: Site[];
  #listeners = new Set<() => void>();

  constructor(readonly file: string) {
    this.#sites = readSites(file);
  }

  list(): readonly Site[] {
    return this.#sites;
  }

  find(id: string): Site | undefined {
    return this.#sites.find((site) => site.id === id);
  }

  /** The site at `address`, an origin, if it's been added. */
  at(address: string): Site | undefined {
    return this.#sites.find((site) => site.address === address);
  }

  add(address: string, name: string): Site {
    const site: Site = { id: randomUUID(), address, name };
    this.#change([...this.#sites, site]);
    return site;
  }

  update(id: string, changes: SiteChanges): void {
    this.#change(this.#sites.map((site) => (site.id === id ? { ...site, ...changes } : site)));
  }

  remove(id: string): void {
    this.#change(this.#sites.filter((site) => site.id !== id));
  }

  /** Calls `listener` whenever the sites change. */
  onChange(listener: () => void): void {
    this.#listeners.add(listener);
  }

  #change(sites: Site[]): void {
    this.#sites = sites;
    writeSites(this.file, sites);
    for (const listener of this.#listeners) listener();
  }
}

/** The sites kept in `file`, leaving out any it doesn't describe whole, or none if there's no such file. */
function readSites(file: string): Site[] {
  let kept: unknown;
  try {
    kept = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const sites = (kept as { sites?: unknown } | null)?.sites;
  return Array.isArray(sites) ? sites.filter(isSite) : [];
}

function writeSites(file: string, sites: Site[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const written = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(written, `${JSON.stringify({ sites }, null, 2)}\n`);
  fs.renameSync(written, file);
}

function isSite(value: unknown): value is Site {
  if (typeof value !== "object" || value === null) return false;
  const { id, address, name, bounds, open } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof address === "string" &&
    siteAddressOf(address) === address &&
    typeof name === "string" &&
    (bounds === undefined || isBounds(bounds)) &&
    (open === undefined || typeof open === "boolean")
  );
}

function isBounds(value: unknown): value is Bounds {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => Number.isInteger(n));
}
