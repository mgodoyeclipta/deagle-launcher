export type WindowMode = "windowed" | "fullscreen" | "borderless";

/** "classic" = 2004-era Steam/HLDS look; "modern" = default HeroUI dark. */
export type Skin = "classic" | "modern";

export interface GameDirStatus {
  engine: boolean;
  executable: boolean;
  quarantined: boolean;
  valve: boolean;
  cstrike: boolean;
  client: boolean;
  bots: boolean;
  supportsDisplay: boolean;
  ok: boolean;
}

export type LaunchAction =
  | { kind: "menu" }
  | { kind: "connect"; address: string }
  | { kind: "bots"; map: string; count: number };

export interface LaunchOptions {
  gameDir: string;
  windowMode: WindowMode;
  width?: number;
  height?: number;
  display?: number;
  action: LaunchAction;
  extraArgs?: string;
  playerName?: string;
}

export interface GameExited {
  code: number | null;
  success: boolean;
  log: string[];
  logPath: string;
}

export interface MonitorInfo {
  /** SDL display index the engine would use for this monitor. */
  index: number;
  name: string;
  /** Logical (point) geometry, as macOS lays the displays out. */
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

/** "native" = the monitor's own resolution. */
export type Resolution = "native" | `${number}x${number}`;

export interface Settings {
  skin: Skin;
  gameDir: string | null;
  windowMode: WindowMode;
  resolution: Resolution;
  display: number;
  botCount: number;
  extraArgs: string;
  minimizeOnLaunch: boolean;
  /** UI sound effects, read from the user's game install. */
  sounds: boolean;
  /** 0–100. */
  volume: number;
  /** Last server the launcher connected to (overrides the in-game history). */
  lastServer: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  skin: "classic",
  gameDir: null,
  windowMode: "borderless",
  resolution: "native",
  display: 0,
  botCount: 9,
  extraArgs: "",
  minimizeOnLaunch: true,
  sounds: true,
  volume: 60,
  lastServer: null,
};
