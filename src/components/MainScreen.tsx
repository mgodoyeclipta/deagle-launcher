import { useEffect, useState } from "react";
import { Alert, Button, Input, Label, ListBox, Select, Spinner, Tabs, TextField } from "@heroui/react";
import type { Key } from "@heroui/react";
import { ArrowRightToSquare, Copy, Gear, Persons, Play, Shuffle } from "@gravity-ui/icons";
import { CrosshairEditor } from "./CrosshairEditor";
import { Credits } from "./Credits";
import { MonitorPicker } from "./MonitorPicker";
import { ServerBrowser } from "./ServerBrowser";
import { SettingsDrawer } from "./SettingsDrawer";
import { platform } from "../lib/platform";
import { cleanName } from "../lib/servers";
import { checkUpdates, type UpdateReport } from "../lib/updates";
import { presenceFor, type Session } from "../lib/presence";
import { sfx } from "../lib/sfx";
import type {
  GameDirStatus,
  GameExited,
  LaunchAction,
  LaunchOptions,
  MonitorInfo,
  ServerInfo,
  Settings,
  SteamStatus,
} from "../lib/types";

interface Props {
  settings: Settings;
  status: GameDirStatus;
  steam: SteamStatus | null;
  onChange: (patch: Partial<Settings>) => void;
  onChangeGameDir: () => void;
}

type Section = "play" | "servers" | "crosshair";

const SERVER_INFO_REFRESH_MS = 30_000;

function pickRandom<T>(list: T[], avoid?: T): T | undefined {
  const pool = list.length > 1 ? list.filter((x) => x !== avoid) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function resolutionFor(settings: Settings, monitor: MonitorInfo | undefined) {
  if (settings.resolution !== "native") {
    const [width, height] = settings.resolution.split("x").map(Number);
    return { width, height };
  }
  // Exclusive fullscreen needs a concrete mode; borderless and windowed
  // use the desktop size / the size the engine remembers.
  if (settings.windowMode === "fullscreen" && monitor) {
    return { width: monitor.width, height: monitor.height };
  }
  return {};
}

/** Retina screens render the game at physical pixels, so the HUD needs 2x. */
function hudScaleFor(settings: Settings, monitor: MonitorInfo | undefined): number | undefined {
  if (settings.hudScale !== "auto") return settings.hudScale;
  return monitor ? Math.max(1, Math.round(monitor.scaleFactor * 2) / 2) : undefined;
}

export function MainScreen({ settings, status, steam, onChange, onChangeGameDir }: Props) {
  const gameDir = settings.gameDir!;
  const [section, setSection] = useState<Section>("play");
  const [name, setName] = useState("");
  const [servers, setServers] = useState<string[]>([]);
  const [serverInfo, setServerInfo] = useState<Record<string, ServerInfo>>({});
  const [maps, setMaps] = useState<string[]>([]);
  const [map, setMap] = useState<string>();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crash, setCrash] = useState<GameExited | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [discordAvailable, setDiscordAvailable] = useState(false);
  const [updates, setUpdates] = useState<UpdateReport | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  async function runUpdateCheck() {
    setCheckingUpdates(true);
    try {
      setUpdates(await checkUpdates(gameDir));
    } finally {
      setCheckingUpdates(false);
    }
  }

  // One check per launch is plenty (GitHub allows 60 anonymous requests per hour).
  useEffect(() => {
    runUpdateCheck();
  }, [gameDir]);

  useEffect(() => {
    platform.discordAvailable().then(setDiscordAvailable).catch(() => {});
  }, []);

  // Discord Rich Presence while playing; refreshed so server players/map stay current.
  useEffect(() => {
    if (!discordAvailable) return;
    if (!running || !session || !settings.discordPresence) {
      platform.discordPresence(null).catch(() => {});
      return;
    }
    let cancelled = false;
    const update = async () => {
      const presence = await presenceFor(session);
      if (!cancelled) platform.discordPresence(presence).catch(() => {});
    };
    update();
    const timer = setInterval(update, SERVER_INFO_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [discordAvailable, running, session, settings.discordPresence]);

  const updateCount = updates
    ? [updates.launcher, updates.engine, updates.client].filter((u) => u.available).length
    : 0;

  useEffect(() => {
    platform.readPlayerName(gameDir, settings.dataDir).then((n) => setName(n ?? ""));
    platform.recentServers(gameDir).then(setServers);
    platform.listMaps(gameDir).then((list) => {
      setMaps(list);
      setMap(list.includes("de_dust2") ? "de_dust2" : pickRandom(list));
    });
    platform.monitors().then(setMonitors);
    platform.isGameRunning().then(setRunning);
  }, [gameDir]);

  useEffect(() => {
    const unlisten = platform.onGameExited((e) => {
      setRunning(false);
      platform.restore();
      setSession(null);
      platform.readPlayerName(gameDir, settings.dataDir).then((n) => n && setName(n));
      platform.recentServers(gameDir).then(setServers);
      if (!e.success) {
        setCrash(e);
        sfx.play("deny");
      }
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [gameDir]);

  useEffect(() => {
    if (crash || error) document.getElementById("launch-feedback")?.scrollIntoView({ behavior: "smooth" });
  }, [crash, error]);

  // Last server the launcher used wins; otherwise the newest in-game history entry.
  const server =
    settings.lastServer && servers.includes(settings.lastServer)
      ? settings.lastServer
      : (servers[0] ?? settings.lastServer);
  const serverOptions = server && !servers.includes(server) ? [server, ...servers] : servers;
  const display = Math.min(settings.display, Math.max(monitors.length - 1, 0));
  const currentInfo = server ? serverInfo[server] : undefined;

  // Live name / map / players for the "Continuar" servers.
  const optionsKey = serverOptions.join(",");
  useEffect(() => {
    if (!serverOptions.length || section !== "play" || running) return;
    let cancelled = false;
    const load = () =>
      platform
        .queryServers(serverOptions)
        .then((list) => {
          if (cancelled) return;
          setServerInfo(Object.fromEntries(list.filter((s) => s.info).map((s) => [s.address, s.info!])));
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, SERVER_INFO_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // serverOptions is represented by optionsKey
  }, [optionsKey, section, running]);

  // Until the engine supports -display it always opens on the main screen.
  const gameMonitor = status.supportsDisplay ? monitors[display] : monitors.find((m) => m.primary);

  async function launch(action: LaunchAction) {
    setError(null);
    setCrash(null);
    const options: LaunchOptions = {
      gameDir,
      windowMode: settings.windowMode,
      ...resolutionFor(settings, monitors[display]),
      display,
      action,
      extraArgs: settings.extraArgs || undefined,
      playerName: name.trim() || undefined,
      dataDir: settings.dataDir ?? undefined,
      hudScale: hudScaleFor(settings, gameMonitor),
    };
    try {
      await platform.launchGame(options);
      setRunning(true);
      setSession({ action, startedAt: Date.now() });
      if (action.kind === "connect") onChange({ lastServer: action.address });
      if (settings.minimizeOnLaunch) platform.minimize();
    } catch (e) {
      setError(String(e));
      sfx.play("deny");
    }
  }

  const serverLabel = (address: string) => {
    const info = serverInfo[address];
    return info ? cleanName(info.name) || address : address;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between px-6 pt-5 pb-3">
        <div>
          <h1 className="text-2xl font-semibold">Deagle Launcher</h1>
          <p className="text-xs text-muted">Para Counter-Strike 1.6 · Xash3D FWGS · cs16-client</p>
        </div>
        <span className="relative">
          <Button
            isIconOnly
            variant="ghost"
            aria-label={updateCount ? `Ajustes (${updateCount} actualizaciones)` : "Ajustes"}
            data-sfx="open"
            onPress={() => setSettingsOpen(true)}
          >
            <Gear />
          </Button>
          {updateCount > 0 && <span className="update-dot" aria-hidden="true" />}
        </span>
      </header>

      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        selectedKey={section}
        onSelectionChange={(key) => setSection(key as Section)}
      >
        <Tabs.ListContainer className="px-6">
          <Tabs.List aria-label="Secciones">
            <Tabs.Tab id="play">
              Jugar
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="servers">
              Servidores
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="crosshair">
              Mira
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="play" className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col gap-5 px-6 pt-4 pb-6">
            {updates?.launcher.available && (
              <Alert status="accent">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Deagle Launcher {updates.launcher.latest} disponible</Alert.Title>
                  <Alert.Description>Tenés la {updates.launcher.current}.</Alert.Description>
                </Alert.Content>
                <Button size="sm" variant="secondary" onPress={() => platform.openUrl(updates.launcher.url)}>
                  Ver
                </Button>
              </Alert>
            )}

            <TextField value={name} onChange={setName} maxLength={31}>
              <Label>Tu nombre</Label>
              <Input placeholder="Player" />
            </TextField>

            <MonitorPicker
              monitors={monitors}
              selected={display}
              supported={status.supportsDisplay}
              onSelect={(index) => onChange({ display: index })}
            />

            <div className="mt-auto flex flex-col gap-3">
              {serverOptions.length > 0 && server && (
                <div className="flex flex-col gap-2">
                  <Button
                    size="lg"
                    fullWidth
                    data-sfx="connect"
                    isDisabled={running}
                    onPress={() => launch({ kind: "connect", address: server })}
                  >
                    <Play />
                    <span className="flex min-w-0 flex-col items-start leading-tight">
                      <span>Continuar</span>
                      {currentInfo && (
                        <span className="max-w-[300px] truncate text-xs font-normal opacity-80">
                          {currentInfo.map} · {currentInfo.players}/{currentInfo.maxPlayers} jugadores ·{" "}
                          {currentInfo.pingMs} ms
                        </span>
                      )}
                    </span>
                  </Button>
                  <Select
                    aria-label="Servidor"
                    className="w-full"
                    value={server as Key}
                    onChange={(key) => key && onChange({ lastServer: String(key) })}
                  >
                    <Select.Trigger>
                      <Select.Value className="truncate text-xs">
                        {({ selectedText }) => selectedText}
                      </Select.Value>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {serverOptions.map((s) => (
                          <ListBox.Item key={s} id={s} textValue={serverLabel(s)}>
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-xs">{serverLabel(s)}</span>
                              {serverInfo[s] && <span className="font-mono text-[11px] opacity-70">{s}</span>}
                            </span>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              )}

              {status.bots && map && (
                <div className="flex gap-2">
                  <Button
                    variant={server ? "secondary" : "primary"}
                    size="lg"
                    className="flex-1"
                    data-sfx="bots"
                    isDisabled={running}
                    onPress={() => launch({ kind: "bots", map, count: settings.botCount })}
                  >
                    <Persons />
                    <span className="flex flex-col items-start leading-tight">
                      <span>Práctica con bots</span>
                      <span className="text-xs font-normal opacity-70">
                        {map} · {settings.botCount} bots
                      </span>
                    </span>
                  </Button>
                  <Button
                    isIconOnly
                    size="lg"
                    variant="secondary"
                    aria-label="Otro mapa al azar"
                    data-sfx="shuffle"
                    isDisabled={running || maps.length < 2}
                    onPress={() => setMap(pickRandom(maps, map))}
                  >
                    <Shuffle />
                  </Button>
                </div>
              )}

              <Button
                variant="tertiary"
                fullWidth
                data-sfx="launch"
                isDisabled={running}
                onPress={() => launch({ kind: "menu" })}
              >
                <ArrowRightToSquare />
                Abrir juego
              </Button>
            </div>
          </div>
        </Tabs.Panel>

        <Tabs.Panel id="servers" className="min-h-0 flex-1 px-6 pt-4 pb-4">
          <ServerBrowser
            settings={settings}
            running={running}
            onChange={onChange}
            onConnect={(address) => launch({ kind: "connect", address })}
          />
        </Tabs.Panel>

        <Tabs.Panel id="crosshair" className="min-h-0 flex-1 px-6 pt-4 pb-4">
          <CrosshairEditor gameDir={gameDir} dataDir={settings.dataDir} running={running} />
        </Tabs.Panel>
      </Tabs>

      {(running || error || crash) && (
        <div className="flex max-h-[45%] flex-col gap-3 overflow-y-auto px-6 pb-4">
          {running && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted">
              <Spinner size="sm" color="accent" />
              Jugando… el launcher vuelve cuando cierres el juego.
            </div>
          )}

          <div id="launch-feedback" />
          {error && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>No se pudo abrir el juego</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}

          {crash && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content className="min-w-0">
                <Alert.Title>
                  El juego se cerró con un error{crash.code !== null ? ` (código ${crash.code})` : ""}
                </Alert.Title>
                <pre className="log-box mt-2 max-h-32 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap select-text">
                  {crash.log.slice(-20).join("\n") || "Sin salida en el log."}
                </pre>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="secondary"
                  onPress={() => navigator.clipboard.writeText(crash.log.join("\n"))}
                >
                  <Copy />
                  Copiar log
                </Button>
              </Alert.Content>
            </Alert>
          )}
        </div>
      )}

      <Credits isOpen={creditsOpen} onOpenChange={setCreditsOpen} />

      <SettingsDrawer
        isOpen={settingsOpen}
        onOpenChange={(open) => {
          if (!open) sfx.play("close");
          setSettingsOpen(open);
        }}
        discordAvailable={discordAvailable}
        steam={steam}
        updates={updates}
        checkingUpdates={checkingUpdates}
        onCheckUpdates={runUpdateCheck}
        onShowCredits={() => {
          setSettingsOpen(false);
          setCreditsOpen(true);
        }}
        settings={settings}
        onChange={onChange}
        onChangeGameDir={() => {
          setSettingsOpen(false);
          onChangeGameDir();
        }}
      />
    </div>
  );
}
