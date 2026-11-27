import { Alert, Button, Spinner } from "@heroui/react";
import {
  ArrowDownToLine,
  ArrowUpRightFromSquare,
  CircleCheck,
  CircleExclamation,
  CircleXmark,
  FolderOpen,
  Wrench,
} from "@gravity-ui/icons";
import { platform } from "../lib/platform";
import type { GameDirStatus, InstallProgress, OfficialInstall, SteamStatus } from "../lib/types";

const STEAM_INSTALL_CS = "steam://install/10";
const STEAM_STORE_CS = "https://store.steampowered.com/app/10/CounterStrike/";

interface Props {
  gameDir: string | null;
  dataDir: string | null;
  steam: SteamStatus | null;
  official: OfficialInstall | null;
  status: GameDirStatus | null;
  busy: boolean;
  installing: boolean;
  progress: InstallProgress | null;
  error: string | null;
  onInstall: () => void;
  onPick: () => void;
  onPickData: () => void;
  onFix: () => void;
  onUseSteam: () => void;
  onContinue: () => void;
}

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="setup-step flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {done ? (
          <CircleCheck className="size-4 text-success" />
        ) : (
          <span className="step-number flex size-4 items-center justify-center text-[11px]">{n}</span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

function checks(s: GameDirStatus, fromSteam: boolean) {
  return [
    { label: "Motor Xash3D", ok: s.engine },
    { label: "Permiso para ejecutar", ok: s.executable },
    { label: "Sin cuarentena de macOS", ok: !s.quarantined },
    { label: fromSteam ? "Archivos de Half-Life (desde Steam)" : "Archivos de Half-Life (valve/)", ok: s.valve },
    { label: fromSteam ? "Archivos de Counter-Strike (desde Steam)" : "Archivos de Counter-Strike (cstrike/)", ok: s.cstrike },
    { label: "cs16-client (binarios y extras.pk3)", ok: s.client },
  ];
}

function GameDataStep({
  steam,
  dataDir,
  ownData,
  onUseSteam,
  onPickData,
}: {
  steam: SteamStatus | null;
  dataDir: string | null;
  ownData: boolean;
  onUseSteam: () => void;
  onPickData: () => void;
}) {
  const usingSteam = !!steam?.dataDir && dataDir === steam.dataDir;
  const done = usingSteam || !!dataDir || ownData;

  return (
    <Step n={1} title="Archivos del juego" done={done}>
      {steam?.csInstalled && steam.dataDir ? (
        <div className="panel flex items-start gap-3 rounded-xl bg-surface p-3">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">Counter-Strike encontrado en Steam</p>
            <p className="truncate text-xs text-muted" title={steam.dataDir}>
              {usingSteam ? "Se usan directamente, sin copiarlos." : steam.dataDir}
            </p>
          </div>
          {!usingSteam && (
            <Button size="sm" variant="secondary" onPress={onUseSteam}>
              Usar
            </Button>
          )}
        </div>
      ) : (
        steam && (
          <div className="panel flex flex-col gap-2 rounded-xl bg-surface p-3">
            <div className="flex items-start gap-3">
              <CircleExclamation className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="min-w-0">
                <p className="text-sm">
                  {steam.steamInstalled ? "Counter-Strike no está instalado en Steam" : "No encontramos Steam"}
                </p>
                <p className="text-xs text-muted">
                  {steam.steamInstalled
                    ? "Instalalo desde Steam: el launcher lo detecta solo cuando termine."
                    : "Necesitás tu copia de Counter-Strike de Steam."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onPress={() => platform.openUrl(steam.steamInstalled ? STEAM_INSTALL_CS : STEAM_STORE_CS)}
            >
              <ArrowUpRightFromSquare />
              {steam.steamInstalled ? "Instalar en Steam" : "Conseguir Counter-Strike en Steam"}
            </Button>
          </div>
        )
      )}

      {dataDir && !usingSteam && (
        <p className="truncate text-xs text-muted" title={dataDir}>
          Usando: {dataDir}
        </p>
      )}
      {!usingSteam && (
        <button type="button" className="sort-link self-start text-xs" onClick={onPickData}>
          Tengo los archivos en otra carpeta (con valve/ y cstrike/)
        </button>
      )}
    </Step>
  );
}

export function SetupScreen(props: Props) {
  const { gameDir, dataDir, steam, official, status, busy, installing, progress, error } = props;
  const usingOfficial = !!official && gameDir === official.gameDir;
  const canFix = !!status?.engine && (!status.executable || status.quarantined);
  const ownData = !!status?.valve && !!status?.cstrike && !dataDir;
  const percent = progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-5 p-6">
        <header className="pt-2">
          <p className="text-sm font-medium tracking-wide text-accent">Deagle Launcher</p>
          <h1 className="mt-1 text-2xl font-semibold">Preparemos el juego</h1>
          <p className="mt-1 text-sm text-muted">
            Usa tu Counter-Strike de Steam y el motor Xash3D FWGS con cs16-client.
          </p>
        </header>

        <GameDataStep
          steam={steam}
          dataDir={dataDir}
          ownData={ownData}
          onUseSteam={props.onUseSteam}
          onPickData={props.onPickData}
        />

        <Step n={2} title="Motor y cliente" done={!!status?.ok && (usingOfficial || !!gameDir)}>
          {usingOfficial && official ? (
            <div className="panel flex items-start gap-3 rounded-xl bg-surface p-3">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">Instalación oficial lista</p>
                <p className="text-xs text-muted">
                  Motor {official.manifest.engineCommit} · cs16-client del{" "}
                  {dateFmt.format(new Date(official.manifest.clientPublishedAt))}
                </p>
              </div>
            </div>
          ) : (
            <>
              <Button size="lg" fullWidth isPending={installing} onPress={props.onInstall}>
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner size="sm" color="current" /> : <ArrowDownToLine />}
                    {isPending ? "Instalando…" : official ? "Usar la instalación oficial" : "Instalar automáticamente (≈21 MB)"}
                  </>
                )}
              </Button>
              {installing && progress && (
                <div className="flex flex-col gap-1">
                  <div className="install-bar panel h-3 overflow-hidden rounded-full bg-surface">
                    <div
                      className="install-bar__fill h-full bg-accent transition-[width]"
                      style={{ width: `${percent ?? 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted">
                    {progress.step === "extract"
                      ? "Descomprimiendo y verificando…"
                      : `${progress.label}: ${mb(progress.downloaded)} de ${mb(progress.total)} MB`}
                  </p>
                </div>
              )}
              <p className="text-[11px] leading-snug text-muted">
                Baja Xash3D FWGS y cs16-client de sus releases oficiales en GitHub, verifica su SHA-256 y los
                instala en la carpeta del launcher.
              </p>
              <Button variant="tertiary" size="sm" className="self-start" isDisabled={installing} onPress={props.onPick}>
                <FolderOpen />
                {gameDir ? "Elegir otra carpeta de Xash3D" : "Usar mi propia carpeta de Xash3D"}
              </Button>
              {gameDir && !usingOfficial && (
                <p className="-mt-1 truncate text-xs text-muted" title={gameDir}>
                  {gameDir}
                </p>
              )}
            </>
          )}

          {status && gameDir && !status.ok && (
            <ul className="panel flex flex-col gap-1 rounded-xl bg-surface p-2">
              {checks(status, !!dataDir).map((c) => (
                <li key={c.label} className="flex items-center gap-3 px-2 py-1">
                  {c.ok ? (
                    <CircleCheck className="size-4 shrink-0 text-success" />
                  ) : (
                    <CircleXmark className="size-4 shrink-0 text-danger" />
                  )}
                  <span className="text-sm">{c.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Step>

        {error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{error}</Alert.Title>
            </Alert.Content>
          </Alert>
        )}

        <div className="mt-auto flex flex-col gap-2">
          {canFix && (
            <Button variant="outline" fullWidth onPress={props.onFix} isPending={busy}>
              <Wrench />
              Arreglar permisos
            </Button>
          )}
          {status?.ok && (
            <Button fullWidth size="lg" onPress={props.onContinue}>
              Listo, ir al launcher
            </Button>
          )}
          <p className="pt-2 text-center text-[11px] leading-snug text-muted">
            Proyecto independiente, sin afiliación con Valve. Counter-Strike y Half-Life son marcas de Valve
            Corporation. Necesitás tu propia copia del juego en Steam.
          </p>
        </div>
      </div>
    </div>
  );
}
