/**
 * Single entry point for everything that talks to the OS.
 *
 * Inside the Tauri app it calls the Rust commands and Tauri plugins. In a
 * plain browser (`npm run dev`) it falls back to an in-memory mock so the UI
 * can be developed and previewed without building the native app.
 */
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Store } from "@tauri-apps/plugin-store";
import packageJson from "../../package.json";
import {
  DEFAULT_SETTINGS,
  type GameDirStatus,
  type GameExited,
  type InstalledVersions,
  type InstallProgress,
  type OfficialInstall,
  type LaunchOptions,
  type MonitorInfo,
  type PlayerInfo,
  type Presence,
  type ServerStatus,
  type Settings,
  type SteamStatus,
} from "./types";

export interface Platform {
  readonly isMock: boolean;
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  pickGameDir(): Promise<string | null>;
  /** Folder picker for the game data (a folder with valve/ and cstrike/). */
  pickDataDir(): Promise<string | null>;
  checkDataDir(path: string): Promise<boolean>;
  /** The launcher-managed install, if one exists. */
  officialInstall(): Promise<OfficialInstall | null>;
  /** Downloads and installs the official engine + cs16-client. */
  installOfficial(): Promise<OfficialInstall>;
  onInstallProgress(handler: (p: InstallProgress) => void): Promise<() => void>;
  /** Deletes the launcher's settings, official installs and logs, then restarts the UI. */
  factoryReset(): Promise<void>;
  checkGameDir(gameDir: string, dataDir: string | null): Promise<GameDirStatus>;
  fixGameDir(gameDir: string, dataDir: string | null): Promise<GameDirStatus>;
  readPlayerName(gameDir: string, dataDir: string | null): Promise<string | null>;
  /** Finds Steam and its Counter-Strike install. */
  detectSteam(): Promise<SteamStatus>;
  recentServers(gameDir: string): Promise<string[]>;
  listMaps(gameDir: string): Promise<string[]>;
  monitors(): Promise<MonitorInfo[]>;
  launchGame(options: LaunchOptions): Promise<void>;
  isGameRunning(): Promise<boolean>;
  onGameExited(handler: (e: GameExited) => void): Promise<() => void>;
  /** Raw WAV bytes of a UI sound from the user's game folder, or null. */
  gameSound(gameDir: string, dataDir: string | null, name: string): Promise<ArrayBuffer | null>;
  /** Live A2S info for each server, in the same order. */
  queryServers(addresses: string[]): Promise<ServerStatus[]>;
  queryPlayers(address: string): Promise<PlayerInfo[]>;
  /** Opens an http(s) link in the default browser. */
  openUrl(url: string): Promise<void>;
  installedVersions(gameDir: string): Promise<InstalledVersions>;
  appVersion(): Promise<string>;
  /** False when this build has no Discord application ID. */
  discordAvailable(): Promise<boolean>;
  /** Sets the Discord Rich Presence, or clears it with null. */
  discordPresence(presence: Presence | null): Promise<void>;
  /** Crosshair and HUD colour cvars from config.cfg. */
  readCrosshair(gameDir: string, dataDir: string | null): Promise<Record<string, string>>;
  /** Saves them; fails while the game is running. */
  writeCrosshair(gameDir: string, dataDir: string | null, values: Record<string, string>): Promise<void>;
  minimize(): Promise<void>;
  restore(): Promise<void>;
  close(): Promise<void>;
}

const SETTINGS_KEY = "settings";

/**
 * Orders monitors the way SDL numbers displays on macOS: the main display
 * (the one at the origin, with the menu bar) is index 0.
 */
function toSdlOrder(list: Omit<MonitorInfo, "index">[]): MonitorInfo[] {
  const primary = list.filter((m) => m.primary);
  const rest = list.filter((m) => !m.primary);
  return [...primary, ...rest].map((m, index) => ({ ...m, index }));
}

const tauriPlatform: Platform = {
  isMock: false,

  async loadSettings() {
    const store = await Store.load("settings.json");
    const saved = await store.get<Partial<Settings>>(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...saved };
  },

  async saveSettings(settings) {
    const store = await Store.load("settings.json");
    await store.set(SETTINGS_KEY, settings);
  },

  async pickGameDir() {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Elegí la carpeta de Xash3D",
    });
    return typeof dir === "string" ? dir : null;
  },

  async pickDataDir() {
    const dir = await open({ directory: true, multiple: false, title: "Elegí la carpeta con valve/ y cstrike/" });
    return typeof dir === "string" ? dir : null;
  },
  checkDataDir: (path) => invoke("check_data_dir", { path }),
  officialInstall: () => invoke("official_install"),
  installOfficial: () => invoke("install_official"),
  onInstallProgress: (handler) => listen<InstallProgress>("install-progress", (e) => handler(e.payload)),
  async factoryReset() {
    // Empty the in-memory store first so nothing saves the old settings back.
    const store = await Store.load("settings.json");
    await store.clear();
    await store.save();
    await invoke("factory_reset");
    location.reload();
  },
  checkGameDir: (gameDir, dataDir) => invoke("check_game_dir", { gameDir, dataDir }),
  fixGameDir: (gameDir, dataDir) => invoke("fix_game_dir", { gameDir, dataDir }),
  readPlayerName: (gameDir, dataDir) => invoke("read_player_name", { gameDir, dataDir }),
  detectSteam: () => invoke("detect_steam"),
  recentServers: (gameDir) => invoke("recent_servers", { gameDir }),
  listMaps: (gameDir) => invoke("list_maps", { gameDir }),

  async monitors() {
    const list = await availableMonitors();
    return toSdlOrder(
      list.map((m, i) => {
        const x = Math.round(m.position.x / m.scaleFactor);
        const y = Math.round(m.position.y / m.scaleFactor);
        return {
          name: m.name ?? `Pantalla ${i + 1}`,
          x,
          y,
          width: Math.round(m.size.width / m.scaleFactor),
          height: Math.round(m.size.height / m.scaleFactor),
          primary: x === 0 && y === 0,
          scaleFactor: m.scaleFactor,
        };
      }),
    );
  },

  launchGame: (options) => invoke("launch_game", { options }),
  isGameRunning: () => invoke("is_game_running"),

  onGameExited: (handler) => listen<GameExited>("game-exited", (e) => handler(e.payload)),

  async gameSound(gameDir, dataDir, name) {
    try {
      return await invoke<ArrayBuffer>("game_sound", { gameDir, dataDir, name });
    } catch {
      return null; // missing file: just stay silent
    }
  },

  queryServers: (addresses) => invoke("query_servers", { addresses }),
  queryPlayers: (address) => invoke("query_players", { address }),
  openUrl: (url) => openUrl(url),
  installedVersions: (gameDir) => invoke("installed_versions", { gameDir }),
  appVersion: () => getVersion(),
  discordAvailable: () => invoke("discord_available"),
  discordPresence: (presence) => invoke("discord_presence", { presence }),
  readCrosshair: (gameDir, dataDir) => invoke("read_crosshair", { gameDir, dataDir }),
  writeCrosshair: (gameDir, dataDir, values) => invoke("write_crosshair", { gameDir, dataDir, values }),

  minimize: () => getCurrentWindow().minimize(),

  close: () => getCurrentWindow().close(),

  async restore() {
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
    await win.setFocus();
  },
};

// ---------------------------------------------------------------------------
// Browser mock (npm run dev without Tauri)
// ---------------------------------------------------------------------------

const MOCK_DIR = "/Users/demo/Downloads/xash3d-fwgs-apple-arm64";
const mockListeners = new Set<(e: GameExited) => void>();
let mockRunning = false;
let mockOfficial: OfficialInstall | null = null;
const mockInstallListeners = new Set<(p: InstallProgress) => void>();
const mockCrosshair: Record<string, string> = {
  xhair_enable: "1",
  xhair_color: "0 255 0 255",
  xhair_size: "4",
  xhair_gap: "-2",
  xhair_thick: "0",
  xhair_pad: "0",
  xhair_dot: "0",
  xhair_t: "0",
  xhair_additive: "0",
  xhair_dynamic_scale: "0",
  xhair_gap_useweaponvalue: "0",
  xhair_dynamic_move: "1",
  cl_crosshair_color: "50 50 250",
  cl_crosshair_size: "small",
  cl_crosshair_translucent: "0",
  cl_dynamiccrosshair: "1",
  hud_color: "255 160 0",
};

function mockStatus(): GameDirStatus {
  return {
    engine: true,
    executable: true,
    quarantined: false,
    valve: true,
    cstrike: true,
    client: true,
    bots: true,
    supportsDisplay: false,
    ok: true,
  };
}

const MOCK_MAPS = ["de_dust2", "de_inferno", "de_nuke", "cs_office", "de_train", "de_aztec"];

/**
 * Made-up server names for the browser preview. Deliberately fictional: the
 * player counts and pings here are fake, so they must not be shown next to
 * real communities' names (e.g. in README screenshots).
 */
const MOCK_SERVER_NAMES = [
  "^1[AR]^7 Público Clásico · Dust2 24/7",
  "[AR] Automix 5vs5 · Liga Ejemplo",
  "[AR] Deathmatch + FFA · 1000 FPS",
  "[AR] Fruta · fy_pool_day only",
  "[AR] Zombie Plague · Levels",
  "[AR] Surf + Respawn",
  "[AR] KreedZ 100aa · Bhop",
  "[AR] Mata al Traidor (TTT)",
  "[AR] Inferno Clásico",
  "[AR] Capturá la Bandera",
  "[AR] Gungame Teamplay",
  "[AR] Público II · Mapas viejos",
];

function mockServer(address: string, i: number): ServerStatus {
  if (i % 7 === 5) return { address, info: null, error: "Sin respuesta" };
  const maxPlayers = i % 3 === 0 ? 20 : 32;
  return {
    address,
    error: null,
    info: {
      name: MOCK_SERVER_NAMES[i % MOCK_SERVER_NAMES.length] + (i >= MOCK_SERVER_NAMES.length ? ` #${Math.floor(i / MOCK_SERVER_NAMES.length) + 1}` : ""),
      map: MOCK_MAPS[i % MOCK_MAPS.length],
      folder: "cstrike",
      game: "Counter-Strike",
      players: (i * 7 + 13) % (maxPlayers + 1),
      maxPlayers,
      bots: i % 4 === 1 ? 8 : 0,
      password: i % 5 === 3,
      vac: true,
      pingMs: 20 + ((i * 37) % 180),
    },
  };
}

const mockPlatform: Platform = {
  isMock: true,

  async loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  async saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode: settings just don't persist */
    }
  },

  pickGameDir: async () => MOCK_DIR,
  pickDataDir: async () => "/Users/demo/Games/Half-Life",
  checkDataDir: async (path) => !path.includes("vacia"),
  officialInstall: async () => mockOfficial,
  async installOfficial() {
    const steps: [InstallProgress["step"], string, number][] = [
      ["engine", "Motor Xash3D FWGS", 5_288_920],
      ["client", "cs16-client", 16_068_205],
    ];
    for (const [step, label, total] of steps) {
      for (let done = 0; done <= total; done += total / 10) {
        mockInstallListeners.forEach((h) => h({ step, label, downloaded: Math.round(done), total }));
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    mockInstallListeners.forEach((h) => h({ step: "extract", label: "Instalando", downloaded: 0, total: 0 }));
    await new Promise((r) => setTimeout(r, 600));
    if (new URLSearchParams(location.search).has("installfail")) throw "No se pudo conectar con GitHub";
    mockOfficial = {
      gameDir: "/Users/demo/Library/Application Support/com.mgodoy.deaglelauncher/installs/oficial",
      manifest: { engineCommit: "bc1b451", enginePublishedAt: "2026-11-24T00:41:47Z", clientPublishedAt: "2026-11-23T21:13:51Z", installedAt: Date.now() / 1000 },
    };
    mockInstallListeners.forEach((h) => h({ step: "done", label: "Listo", downloaded: 0, total: 0 }));
    return mockOfficial;
  },
  async factoryReset() {
    if (mockRunning) throw "Cerrá el juego antes de restablecer el launcher";
    localStorage.clear();
    mockOfficial = null;
    location.reload();
  },
  async onInstallProgress(handler) {
    mockInstallListeners.add(handler);
    return () => mockInstallListeners.delete(handler);
  },
  checkGameDir: async () => mockStatus(),
  fixGameDir: async () => mockStatus(),
  readPlayerName: async () => "matiGOD",
  detectSteam: async () => {
    const mode = new URLSearchParams(location.search).get("steam");
    if (mode === "none") return { steamInstalled: false, csInstalled: false, dataDir: null };
    if (mode === "nocs") return { steamInstalled: true, csInstalled: false, dataDir: null };
    return { steamInstalled: true, csInstalled: true, dataDir: "/Users/demo/Library/Application Support/Steam/steamapps/common/Half-Life" };
  },
  recentServers: async () => ["45.235.98.52:27038", "82.77.209.165:27015", "186.19.63.56:27015"],
  listMaps: async () => ["cs_italy", "cs_office", "de_aztec", "de_dust2", "de_inferno", "de_nuke", "de_train"],

  monitors: async () =>
    toSdlOrder([
      { name: "Pantalla integrada", x: 0, y: 0, width: 1512, height: 982, primary: true, scaleFactor: 2 },
      { name: "LF22T35", x: 1512, y: -98, width: 1920, height: 1080, primary: false, scaleFactor: 1 },
    ]),

  async launchGame() {
    if (mockRunning) throw "El juego ya está abierto";
    mockRunning = true;
    const crash = new URLSearchParams(location.search).has("crash");
    setTimeout(() => {
      mockRunning = false;
      const event: GameExited = crash
        ? {
            code: null,
            success: false,
            log: ["Xash3D FWGS (build 4045)", "Loading cstrike/cl_dlls/client_arm64.dylib", "Segmentation fault"],
            logPath: "~/Library/Logs/com.mgodoy.deaglelauncher/game.log",
          }
        : { code: 0, success: true, log: [], logPath: "" };
      mockListeners.forEach((h) => h(event));
    }, 3000);
  },

  isGameRunning: async () => mockRunning,

  async onGameExited(handler) {
    mockListeners.add(handler);
    return () => mockListeners.delete(handler);
  },

  // Valve sounds are not available outside the native app.
  gameSound: async () => null,

  async queryServers(addresses) {
    await new Promise((r) => setTimeout(r, 400));
    return addresses.map((address, i) => mockServer(address, i));
  },

  async queryPlayers() {
    await new Promise((r) => setTimeout(r, 300));
    return ["matiGOD", "^1[ARG]^7 Pibe", "Gordo_AWP", "xX_deagle_Xx", "Player"].map((name, i) => ({
      name,
      score: 20 - i * 4,
      durationSecs: 3600 - i * 700,
    }));
  },

  openUrl: async (url) => {
    window.open(url, "_blank");
  },

  installedVersions: async () => ({
    engine: { build: 4045, commit: "7d87d65", branch: "master", platform: "apple-arm64" },
    clientBuiltAt: Date.UTC(2026, 3, 29) / 1000,
  }),
  appVersion: async () => packageJson.version,
  // Like real builds without a Discord application ID; add ?discord to preview the toggle.
  discordAvailable: async () => new URLSearchParams(location.search).has("discord"),
  discordPresence: async (presence) => {
    console.info("[mock] Discord presence", presence);
  },

  readCrosshair: async () => ({ ...mockCrosshair }),
  writeCrosshair: async (_gameDir, _dataDir, values) => {
    if (mockRunning) throw "Cerrá el juego para guardar la mira: el juego reescribe su configuración al salir.";
    Object.assign(mockCrosshair, values);
  },

  minimize: async () => {},
  restore: async () => {},
  close: async () => {},
};

export const platform: Platform = isTauri() ? tauriPlatform : mockPlatform;
