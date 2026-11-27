/**
 * Update checker: compares the launcher, the Xash3D FWGS engine and
 * cs16-client against their official GitHub releases. It only informs and
 * links to the release page; it never downloads or replaces files.
 */
import { platform } from "./platform";
import type { OfficialInstall } from "./types";

const API = "https://api.github.com";

const LAUNCHER_REPO = "mgodoyeclipta/deagle-launcher";
const ENGINE_REPO = "FWGS/xash3d-fwgs";
const CLIENT_REPO = "Velaron/cs16-client";

/** cs16-client's build date vs. its release date: allow a day of slack for timezones/CI. */
const CLIENT_SLACK_MS = 24 * 60 * 60 * 1000;

export interface ComponentUpdate {
  available: boolean;
  /** What you have, human readable. */
  current: string | null;
  /** Latest official version, human readable. */
  latest: string | null;
  url: string;
  /** Set when this component could not be checked. */
  error?: string;
}

export interface UpdateReport {
  checkedAt: Date;
  launcher: ComponentUpdate;
  engine: ComponentUpdate;
  client: ComponentUpdate;
}

async function github<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 403 || res.status === 429) throw new Error("GitHub limitó las consultas, probá más tarde");
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  return res.json() as Promise<T>;
}

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

/** "0.10.1" > "0.9.3"; ignores a leading "v" and anything after "-". */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => Number(n) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function checkLauncher(): Promise<ComponentUpdate> {
  const url = `https://github.com/${LAUNCHER_REPO}/releases/latest`;
  const current = await platform.appVersion();
  try {
    const release = await github<{ tag_name: string; html_url: string }>(`repos/${LAUNCHER_REPO}/releases/latest`);
    return {
      available: isNewerVersion(release.tag_name, current),
      current: `v${current}`,
      latest: release.tag_name,
      url: release.html_url,
    };
  } catch (e) {
    return { available: false, current: `v${current}`, latest: null, url, error: String((e as Error).message ?? e) };
  }
}

/** What's installed: the commit, and how to describe it. */
interface EngineRef {
  commit: string;
  label: string;
}

async function checkEngine(installed: EngineRef | null): Promise<ComponentUpdate> {
  const url = `https://github.com/${ENGINE_REPO}/releases/tag/continuous`;
  const current = installed?.label ?? null;
  try {
    const latest = await github<{ sha: string; commit: { committer: { date: string } } }>(
      `repos/${ENGINE_REPO}/commits/continuous`,
    );
    const latestLabel = `${latest.sha.slice(0, 7)} · ${dateFmt.format(new Date(latest.commit.committer.date))}`;
    if (!installed) {
      return { available: false, current, latest: latestLabel, url, error: "Abrí el juego una vez para detectar tu versión" };
    }
    if (latest.sha.startsWith(installed.commit)) {
      return { available: false, current, latest: latestLabel, url };
    }
    let behind = "";
    try {
      const cmp = await github<{ ahead_by: number }>(`repos/${ENGINE_REPO}/compare/${installed.commit}...${latest.sha}`);
      if (cmp.ahead_by > 0) behind = ` (${cmp.ahead_by} cambios nuevos)`;
    } catch {
      /* the count is a nice-to-have */
    }
    return { available: true, current, latest: latestLabel + behind, url };
  } catch (e) {
    return { available: false, current, latest: null, url, error: String((e as Error).message ?? e) };
  }
}

async function checkClient(builtAt: number | null, official = false): Promise<ComponentUpdate> {
  const url = `https://github.com/${CLIENT_REPO}/releases/tag/continuous`;
  const when = builtAt ? dateFmt.format(new Date(builtAt * 1000)) : null;
  const current = when ? (official ? `oficial del ${when}` : `compilado el ${when}`) : null;
  try {
    const release = await github<{ published_at: string }>(`repos/${CLIENT_REPO}/releases/tags/continuous`);
    const published = new Date(release.published_at);
    return {
      available: !!builtAt && published.getTime() - builtAt * 1000 > CLIENT_SLACK_MS,
      current,
      latest: `oficial del ${dateFmt.format(published)}`,
      url,
    };
  } catch (e) {
    return { available: false, current, latest: null, url, error: String((e as Error).message ?? e) };
  }
}

/**
 * For the launcher's own official install the versions come from its install
 * record (exact commit and release date); for a custom folder they are read
 * from the engine's .cfg header and the client library's date.
 */
export async function checkUpdates(gameDir: string, official?: OfficialInstall | null): Promise<UpdateReport> {
  const managed = official && official.gameDir === gameDir ? official.manifest : null;
  let engineRef: EngineRef | null;
  let clientDate: number | null;
  if (managed) {
    engineRef = { commit: managed.engineCommit, label: `oficial (${managed.engineCommit})` };
    clientDate = Date.parse(managed.clientPublishedAt) / 1000;
  } else {
    const installed = await platform.installedVersions(gameDir);
    engineRef = installed.engine
      ? { commit: installed.engine.commit, label: `build ${installed.engine.build} (${installed.engine.commit})` }
      : null;
    clientDate = installed.clientBuiltAt;
  }
  const [launcher, engine, client] = await Promise.all([checkLauncher(), checkEngine(engineRef), checkClient(clientDate, !!managed)]);
  return { checkedAt: new Date(), launcher, engine, client };
}
