import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import { MainScreen } from "./components/MainScreen";
import { SetupScreen } from "./components/SetupScreen";
import { TitleBar } from "./components/TitleBar";
import { platform } from "./lib/platform";
import { installClickSounds, sfx } from "./lib/sfx";
import type { GameDirStatus, InstallManifest, InstallProgress, OfficialInstall, Settings, SteamStatus } from "./lib/types";

type Phase = "loading" | "setup" | "main";

export default function App() {
  return (
    <div className="app-window flex h-full flex-col">
      <TitleBar title="Deagle Launcher" />
      <div className="min-h-0 flex-1">
        <Screens />
      </div>
    </div>
  );
}

function Screens() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<GameDirStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steam, setSteam] = useState<SteamStatus | null>(null);
  const [official, setOfficial] = useState<OfficialInstall | null>(null);
  const [previous, setPrevious] = useState<InstallManifest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);

  useEffect(() => {
    (async () => {
      const [loaded, steamStatus, officialInstall] = await Promise.all([
        platform.loadSettings(),
        platform.detectSteam(),
        platform.officialInstall(),
      ]);
      setSteam(steamStatus);
      setOfficial(officialInstall);
      platform.previousInstall().then(setPrevious).catch(() => {});
      setSettings(loaded);
      if (loaded.gameDir) {
        const s = await platform.checkGameDir(loaded.gameDir, loaded.dataDir);
        setStatus(s);
        setPhase(s.ok ? "main" : "setup");
      } else {
        setPhase("setup");
      }
    })();
  }, []);

  // While Counter-Strike is missing from Steam (e.g. it's installing right now), keep looking.
  useEffect(() => {
    if (phase !== "setup" || !steam?.steamInstalled || steam.csInstalled) return;
    const timer = setInterval(() => platform.detectSteam().then(setSteam).catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [phase, steam?.steamInstalled, steam?.csInstalled]);

  // Re-check the install whenever its folder or data source changes.
  useEffect(() => {
    if (!settings?.gameDir || phase === "loading") return;
    platform.checkGameDir(settings.gameDir, settings.dataDir).then(setStatus).catch(() => {});
  }, [settings?.gameDir, settings?.dataDir, steam?.dataDir]);

  useEffect(() => {
    if (settings) document.documentElement.dataset.skin = settings.skin;
  }, [settings?.skin]);

  useEffect(() => installClickSounds(), []);

  useEffect(() => {
    if (!settings) return;
    sfx.configure({
      gameDir: settings.gameDir,
      dataDir: settings.dataDir,
      enabled: settings.sounds,
      volume: settings.volume,
    });
  }, [settings?.gameDir, settings?.dataDir, settings?.sounds, settings?.volume]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      platform.saveSettings(next);
      return next;
    });
  }, []);

  async function pickDir() {
    setError(null);
    const dir = await platform.pickGameDir();
    if (!dir) return;
    setBusy(true);
    try {
      // Use the folder's own valve/ and cstrike/ if it has them; otherwise Steam's.
      const own = await platform.checkGameDir(dir, null);
      const dataDir = own.valve && own.cstrike ? null : (steam?.dataDir ?? null);
      update({ gameDir: dir, dataDir, lastServer: null });
      setStatus(dataDir ? await platform.checkGameDir(dir, dataDir) : own);
      setPhase("setup");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The data folder a fresh official install should read: what's set, or Steam's. */
  const dataDirFor = () => settings?.dataDir ?? steam?.dataDir ?? null;

  async function installOfficial() {
    setError(null);
    // Already installed: just switch to it.
    if (official) {
      update({ gameDir: official.gameDir, dataDir: dataDirFor() });
      return;
    }
    setInstalling(true);
    setProgress(null);
    const off = await platform.onInstallProgress(setProgress);
    try {
      const result = await platform.installOfficial();
      setOfficial(result);
      update({ gameDir: result.gameDir, dataDir: dataDirFor() });
    } catch (e) {
      setError(`No se pudo instalar: ${String(e)}`);
    } finally {
      off();
      setInstalling(false);
    }
  }

  /** Re-downloads the latest official engine + client (keeps the current one as "previous"). */
  async function updateOfficial(): Promise<string | null> {
    setInstalling(true);
    setProgress(null);
    const off = await platform.onInstallProgress(setProgress);
    try {
      const result = await platform.installOfficial();
      setOfficial(result);
      setPrevious(await platform.previousInstall());
      update({ gameDir: result.gameDir });
      return null;
    } catch (e) {
      return `No se pudo actualizar: ${String(e)}`;
    } finally {
      off();
      setInstalling(false);
    }
  }

  async function rollbackOfficial(): Promise<string | null> {
    try {
      const result = await platform.rollbackOfficial();
      setOfficial(result);
      setPrevious(await platform.previousInstall());
      update({ gameDir: result.gameDir });
      return null;
    } catch (e) {
      return String(e);
    }
  }

  async function pickDataDir() {
    setError(null);
    const dir = await platform.pickDataDir();
    if (!dir) return;
    if (await platform.checkDataDir(dir)) {
      update({ dataDir: dir });
    } else {
      setError("Esa carpeta no tiene valve/ y cstrike/. Elegí la carpeta de Half-Life que los contiene.");
    }
  }

  async function fixDir() {
    if (!settings?.gameDir) return;
    setError(null);
    setBusy(true);
    try {
      setStatus(await platform.fixGameDir(settings.gameDir, settings.dataDir));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading" || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner color="accent" />
      </div>
    );
  }

  if (phase === "setup" || !status?.ok) {
    return (
      <SetupScreen
        gameDir={settings.gameDir}
        dataDir={settings.dataDir}
        steam={steam}
        official={official}
        status={status}
        busy={busy}
        installing={installing}
        progress={progress}
        error={error}
        onInstall={installOfficial}
        onPick={pickDir}
        onPickData={pickDataDir}
        onFix={fixDir}
        onUseSteam={() => steam?.dataDir && update({ dataDir: steam.dataDir })}
        onContinue={() => setPhase("main")}
      />
    );
  }

  return (
    <MainScreen
      settings={settings}
      status={status}
      steam={steam}
      official={official}
      previous={previous}
      installing={installing}
      progress={progress}
      onUpdateOfficial={updateOfficial}
      onRollbackOfficial={rollbackOfficial}
      onChange={update}
      onChangeGameDir={() => setPhase("setup")}
    />
  );
}
