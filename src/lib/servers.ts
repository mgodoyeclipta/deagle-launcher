/**
 * Where server addresses come from, plus small display helpers.
 *
 * Live data (name, map, players, ping) always comes from the servers
 * themselves via A2S queries in Rust — no third-party tracker is scraped.
 */
import bundledArgentina from "../../servers/argentina.json";

export type ServerSource = "argentina" | "internet" | "history" | "favorites";

export interface CuratedServer {
  address: string;
  name?: string;
}

/** Community list in this repo; fetched fresh so new servers don't need a release. */
const ARGENTINA_URL =
  "https://raw.githubusercontent.com/mgodoyeclipta/deagle-launcher/main/servers/argentina.json";

/** Public list the Xash3D FWGS engine itself uses for its server browser. */
const XASH_LIST_URL = "https://xash.su/server-list/v1/servers/cstrike";

const ADDRESS_RE = /^[A-Za-z0-9.-]+:\d{1,5}$/;

export function isValidAddress(address: string): boolean {
  return ADDRESS_RE.test(address);
}

function curatedFrom(data: unknown): CuratedServer[] | null {
  const servers = (data as { servers?: unknown })?.servers;
  if (!Array.isArray(servers)) return null;
  return servers.filter(
    (s): s is CuratedServer => typeof s?.address === "string" && isValidAddress(s.address),
  );
}

/**
 * The list bundled with the app plus whatever is published on GitHub (so new
 * servers show up without an update). Names from GitHub win if both have one.
 */
export async function argentinaServers(): Promise<CuratedServer[]> {
  const merged = new Map<string, CuratedServer>();
  for (const s of curatedFrom(bundledArgentina) ?? []) merged.set(s.address, s);
  try {
    const res = await fetch(ARGENTINA_URL, { cache: "no-store" });
    if (res.ok) {
      for (const s of curatedFrom(await res.json()) ?? []) {
        merged.set(s.address, { ...merged.get(s.address), ...s });
      }
    }
  } catch {
    /* offline: the bundled list is enough */
  }
  return [...merged.values()];
}

/** Parses the Xash list: comment lines start with `#`, entries are `<ip|gs> <address>`. */
export function parseXashList(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const [, address] = line.trim().split(/\s+/);
    if (!line.startsWith("#") && address && isValidAddress(address)) out.add(address);
  }
  return [...out];
}

export async function internetServers(): Promise<string[]> {
  const res = await fetch(XASH_LIST_URL);
  if (!res.ok) throw new Error(`La lista pública respondió ${res.status}`);
  return parseXashList(await res.text());
}

/** Removes GoldSrc colour codes like `^1` from server and player names. */
export function cleanName(name: string): string {
  return name.replace(/\^\d/g, "").replace(/\s+/g, " ").trim();
}

/** GameTracker's list of Counter-Strike 1.6 servers in Argentina (opened in the browser). */
export const GAMETRACKER_ARGENTINA = "https://www.gametracker.com/search/cs/AR/";

/** Public GameTracker page for a server (just a link: their data is not scraped). */
export function gametrackerUrl(address: string): string {
  return `https://www.gametracker.com/server_info/${address}/`;
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function pingLevel(ms: number): "good" | "ok" | "bad" {
  return ms < 60 ? "good" : ms < 120 ? "ok" : "bad";
}
