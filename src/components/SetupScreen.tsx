import { Alert, Button, Spinner } from "@heroui/react";
import { ArrowUpRightFromSquare, CircleCheck, CircleExclamation, CircleXmark, FolderOpen, Wrench } from "@gravity-ui/icons";
import { platform } from "../lib/platform";
import type { GameDirStatus, SteamStatus } from "../lib/types";

const STEAM_INSTALL_CS = "steam://install/10";
const STEAM_STORE_CS = "https://store.steampowered.com/app/10/CounterStrike/";

interface Props {
  gameDir: string | null;
  dataDir: string | null;
  steam: SteamStatus | null;
  status: GameDirStatus | null;
  busy: boolean;
  error: string | null;
  onPick: () => void;
  onFix: () => void;
  onUseSteam: () => void;
  onContinue: () => void;
}

interface Check {
  label: string;
  hint: string;
  ok: boolean;
}

function checks(s: GameDirStatus, fromSteam: boolean): Check[] {
  return [
    { label: "Motor Xash3D", hint: "El archivo xash3d", ok: s.engine },
    { label: "Permiso para ejecutar", hint: "xash3d marcado como ejecutable", ok: s.executable },
    { label: "Sin cuarentena de macOS", hint: "Gatekeeper no lo bloquea", ok: !s.quarantined },
    { label: "Archivos de Half-Life (valve/)", hint: fromSteam ? "Desde tu Steam" : "En la carpeta del juego", ok: s.valve },
    { label: "Archivos de Counter-Strike (cstrike/)", hint: fromSteam ? "Desde tu Steam" : "En la carpeta del juego", ok: s.cstrike },
    { label: "cs16-client", hint: "Binarios en cstrike/cl_dlls y extras.pk3", ok: s.client },
  ];
}

function SteamCard({
  steam,
  dataDir,
  onUseSteam,
}: {
  steam: SteamStatus | null;
  dataDir: string | null;
  onUseSteam: () => void;
}) {
  if (!steam) return null;

  if (steam.csInstalled && steam.dataDir) {
    const using = dataDir === steam.dataDir;
    return (
      <div className="panel flex items-start gap-3 rounded-xl bg-surface p-3">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">Counter-Strike encontrado en Steam</p>
          <p className="truncate text-xs text-muted" title={steam.dataDir}>
            {using ? "El launcher usa estos archivos directamente, sin copiarlos." : steam.dataDir}
          </p>
        </div>
        {!using && (
          <Button size="sm" variant="secondary" onPress={onUseSteam}>
            Usar
          </Button>
        )}
      </div>
    );
  }

  return (
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
              : "Necesitás tu copia de Counter-Strike en Steam, o una carpeta con valve/ y cstrike/."}
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
  );
}

export function SetupScreen({
  gameDir,
  dataDir,
  steam,
  status,
  busy,
  error,
  onPick,
  onFix,
  onUseSteam,
  onContinue,
}: Props) {
  const canFix = !!status?.engine && (!status.executable || status.quarantined);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-6 p-6">
        <header className="pt-4">
          <p className="text-sm font-medium tracking-wide text-accent">Deagle Launcher</p>
          <h1 className="mt-1 text-2xl font-semibold">Configuremos tu juego</h1>
          <p className="mt-2 text-sm text-muted">
            El launcher no incluye el juego: usa tu copia de Counter-Strike de Steam y el motor Xash3D FWGS
            con cs16-client.
          </p>
        </header>

        <SteamCard steam={steam} dataDir={dataDir} onUseSteam={onUseSteam} />

        <Button variant="secondary" size="lg" fullWidth onPress={onPick} isPending={busy}>
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : <FolderOpen />}
              {gameDir ? "Elegir otra carpeta" : "Elegir carpeta de Xash3D"}
            </>
          )}
        </Button>

        {gameDir && (
          <p className="-mt-3 truncate text-xs text-muted" title={gameDir}>
            {gameDir}
          </p>
        )}

        {status && (
          <ul className="panel flex flex-col gap-1 rounded-xl bg-surface p-2">
            {checks(status, !!dataDir).map((c) => (
              <li key={c.label} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                {c.ok ? (
                  <CircleCheck className="size-4 shrink-0 text-success" />
                ) : (
                  <CircleXmark className="size-4 shrink-0 text-danger" />
                )}
                <div className="min-w-0">
                  <p className="text-sm">{c.label}</p>
                  <p className="text-xs text-muted">{c.hint}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

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
            <Button variant="outline" fullWidth onPress={onFix} isPending={busy}>
              <Wrench />
              Arreglar permisos
            </Button>
          )}
          {status?.ok && (
            <Button fullWidth size="lg" onPress={onContinue}>
              Listo, ir al launcher
            </Button>
          )}
          <p className="pt-2 text-center text-[11px] leading-snug text-muted">
            Proyecto independiente, sin afiliación con Valve. Counter-Strike y Half-Life son marcas
            de Valve Corporation. Necesitás tu propia copia del juego en Steam.
          </p>
        </div>
      </div>
    </div>
  );
}
