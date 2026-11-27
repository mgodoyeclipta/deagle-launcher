/**
 * UI sound effects using classic Half-Life / Counter-Strike sounds read from
 * the user's own game folder (see `sound_file` in src-tauri/src/game.rs).
 *
 * Any element can pick its sound with `data-sfx="<name>"`, or opt out with
 * `data-sfx="none"`. Other buttons, options and checkboxes get "click".
 */
import { platform } from "./platform";
import { decodeWav } from "./wav";

export type SoundName =
  | "click"
  | "open"
  | "close"
  | "select"
  | "deny"
  | "connect"
  | "bots"
  | "launch"
  | "shuffle";

const ALL_SOUNDS: SoundName[] = ["click", "open", "close", "select", "deny", "connect", "bots", "launch", "shuffle"];

/** Quiet files (the HL menu sounds) get boosted, loud ones tamed, so all sit at a similar level. */
const TARGET_PEAK = 0.7;
const MAX_BOOST = 4;

interface Loaded {
  buffer: AudioBuffer;
  gain: number;
}

let ctx: AudioContext | null = null;
let gameDir: string | null = null;
let dataDir: string | null = null;
let enabled = true;
let volume = 0.6;
let cache = new Map<SoundName, Promise<Loaded | null>>();

function context(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

async function load(name: SoundName): Promise<Loaded | null> {
  if (!gameDir) return null;
  const bytes = await platform.gameSound(gameDir, dataDir, name);
  if (!bytes) return null;
  const wav = decodeWav(bytes);
  if (!wav) return null;

  const audio = context();
  const buffer = audio.createBuffer(wav.channels.length, wav.channels[0].length, wav.sampleRate);
  let peak = 0;
  wav.channels.forEach((data, i) => {
    buffer.copyToChannel(data, i);
    for (const v of data) peak = Math.max(peak, Math.abs(v));
  });
  const gain = peak > 0 ? Math.min(MAX_BOOST, TARGET_PEAK / peak) : 1;
  return { buffer, gain };
}

function get(name: SoundName) {
  let entry = cache.get(name);
  if (!entry) {
    entry = load(name).catch(() => null);
    cache.set(name, entry);
  }
  return entry;
}

export const sfx = {
  configure(options: { gameDir: string | null; dataDir: string | null; enabled: boolean; volume: number }) {
    if (options.gameDir !== gameDir || options.dataDir !== dataDir) {
      gameDir = options.gameDir;
      dataDir = options.dataDir;
      cache = new Map();
      if (gameDir) ALL_SOUNDS.forEach(get); // preload: first click should not lag
    }
    enabled = options.enabled;
    volume = Math.max(0, Math.min(1, options.volume / 100));
  },

  async play(name: SoundName) {
    if (!enabled || volume === 0 || !gameDir) return;
    const loaded = await get(name);
    if (!loaded) return;
    const audio = context();
    if (audio.state === "suspended") await audio.resume();

    const source = audio.createBufferSource();
    source.buffer = loaded.buffer;
    const gain = audio.createGain();
    gain.gain.value = loaded.gain * volume;
    source.connect(gain).connect(audio.destination);
    source.start();
  },
};

// A switch can report both its label and its hidden input; the dedupe below
// keeps that to one sound per toggle.
const CLICKABLE = 'button, [role="option"], [role="switch"], [role="checkbox"], .switch__content';
const DEDUPE_MS = 100;

/** One document-level listener gives every control its click sound. */
export function installClickSounds(): () => void {
  let last: { key: Element; at: number } | null = null;
  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const el = target?.closest?.(CLICKABLE);
    if (!el || el.closest('[aria-disabled="true"], :disabled')) return;
    // Closing the drawer plays "close" from its onOpenChange instead.
    if (el.matches(".drawer__close-trigger")) return;
    const key = el.closest(".switch") ?? el;
    if (last && last.key === key && event.timeStamp - last.at < DEDUPE_MS) return;
    last = { key, at: event.timeStamp };
    const named = el.closest("[data-sfx]")?.getAttribute("data-sfx");
    if (named === "none") return;
    sfx.play((named as SoundName | null) ?? "click");
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
