import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import { MainScreen } from "./components/MainScreen";
import { SetupScreen } from "./components/SetupScreen";
import { platform } from "./lib/platform";
import type { GameDirStatus, Settings } from "./lib/types";

type Phase = "loading" | "setup" | "main";

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<GameDirStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const loaded = await platform.loadSettings();
      setSettings(loaded);
      if (loaded.gameDir) {
        const s = await platform.checkGameDir(loaded.gameDir);
        setStatus(s);
        setPhase(s.ok ? "main" : "setup");
      } else {
        setPhase("setup");
      }
    })();
  }, []);

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
      update({ gameDir: dir, lastServer: null });
      setStatus(await platform.checkGameDir(dir));
      setPhase("setup");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fixDir() {
    if (!settings?.gameDir) return;
    setError(null);
    setBusy(true);
    try {
      setStatus(await platform.fixGameDir(settings.gameDir));
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
        status={status}
        busy={busy}
        error={error}
        onPick={pickDir}
        onFix={fixDir}
        onContinue={() => setPhase("main")}
      />
    );
  }

  return <MainScreen settings={settings} status={status} onChange={update} onChangeGameDir={pickDir} />;
}
