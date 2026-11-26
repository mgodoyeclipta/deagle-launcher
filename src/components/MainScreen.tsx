import { useEffect, useState } from "react";
import { Alert, Button, Input, Label, ListBox, Select, Spinner, TextField } from "@heroui/react";
import type { Key } from "@heroui/react";
import { ArrowRightToSquare, Copy, Gear, Persons, Play, Shuffle } from "@gravity-ui/icons";
import { MonitorPicker } from "./MonitorPicker";
import { SettingsDrawer } from "./SettingsDrawer";
import { platform } from "../lib/platform";
import type { GameDirStatus, GameExited, LaunchAction, LaunchOptions, MonitorInfo, Settings } from "../lib/types";

interface Props {
  settings: Settings;
  status: GameDirStatus;
  onChange: (patch: Partial<Settings>) => void;
  onChangeGameDir: () => void;
}

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

export function MainScreen({ settings, status, onChange, onChangeGameDir }: Props) {
  const gameDir = settings.gameDir!;
  const [name, setName] = useState("");
  const [servers, setServers] = useState<string[]>([]);
  const [maps, setMaps] = useState<string[]>([]);
  const [map, setMap] = useState<string>();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crash, setCrash] = useState<GameExited | null>(null);

  useEffect(() => {
    platform.readPlayerName(gameDir).then((n) => setName(n ?? ""));
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
      platform.readPlayerName(gameDir).then((n) => n && setName(n));
      platform.recentServers(gameDir).then(setServers);
      if (!e.success) setCrash(e);
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
    };
    try {
      await platform.launchGame(options);
      setRunning(true);
      if (action.kind === "connect") onChange({ lastServer: action.address });
      if (settings.minimizeOnLaunch) platform.minimize();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-5 p-6">
        <header className="flex items-start justify-between pt-2">
          <div>
            <h1 className="text-2xl font-semibold">Deagle Launcher</h1>
            <p className="text-xs text-muted">Para Counter-Strike 1.6 · Xash3D FWGS · cs16-client</p>
          </div>
          <Button isIconOnly variant="ghost" aria-label="Ajustes" onPress={() => setSettingsOpen(true)}>
            <Gear />
          </Button>
        </header>

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
              <Button size="lg" fullWidth isDisabled={running} onPress={() => launch({ kind: "connect", address: server })}>
                <Play />
                Continuar
              </Button>
              <Select
                aria-label="Servidor"
                className="w-full"
                value={server as Key}
                onChange={(key) => key && onChange({ lastServer: String(key) })}
              >
                <Select.Trigger>
                  <Select.Value className="font-mono text-xs" />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {serverOptions.map((s) => (
                      <ListBox.Item key={s} id={s} textValue={s}>
                        <span className="font-mono text-xs">{s}</span>
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
                isDisabled={running || maps.length < 2}
                onPress={() => setMap(pickRandom(maps, map))}
              >
                <Shuffle />
              </Button>
            </div>
          )}

          <Button variant="tertiary" fullWidth isDisabled={running} onPress={() => launch({ kind: "menu" })}>
            <ArrowRightToSquare />
            Abrir juego
          </Button>

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
                <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap select-text">
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

        <SettingsDrawer
          isOpen={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onChange={onChange}
          onChangeGameDir={() => {
            setSettingsOpen(false);
            onChangeGameDir();
          }}
        />
      </div>
    </div>
  );
}
