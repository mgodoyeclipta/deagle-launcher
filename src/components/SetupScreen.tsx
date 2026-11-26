import { Alert, Button, Spinner } from "@heroui/react";
import { CircleCheck, CircleXmark, FolderOpen, Wrench } from "@gravity-ui/icons";
import type { GameDirStatus } from "../lib/types";

interface Props {
  gameDir: string | null;
  status: GameDirStatus | null;
  busy: boolean;
  error: string | null;
  onPick: () => void;
  onFix: () => void;
  onContinue: () => void;
}

interface Check {
  label: string;
  hint: string;
  ok: boolean;
}

function checks(s: GameDirStatus): Check[] {
  return [
    { label: "Motor Xash3D", hint: "El archivo xash3d", ok: s.engine },
    { label: "Permiso para ejecutar", hint: "xash3d marcado como ejecutable", ok: s.executable },
    { label: "Sin cuarentena de macOS", hint: "Gatekeeper no lo bloquea", ok: !s.quarantined },
    { label: "Carpeta valve/", hint: "Copiada de tu Half-Life de Steam", ok: s.valve },
    { label: "Carpeta cstrike/", hint: "Copiada de tu CS 1.6 de Steam", ok: s.cstrike },
    { label: "cs16-client", hint: "Instalado en cstrike/cl_dlls", ok: s.client },
  ];
}

export function SetupScreen({ gameDir, status, busy, error, onPick, onFix, onContinue }: Props) {
  const canFix = !!status?.engine && (!status.executable || status.quarantined);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-6 p-6">
        <header className="pt-4">
          <p className="text-sm font-medium tracking-wide text-accent">Deagle Launcher</p>
          <h1 className="mt-1 text-2xl font-semibold">Configuremos tu juego</h1>
          <p className="mt-2 text-sm text-muted">
            El launcher no incluye el juego. Elegí la carpeta de Xash3D donde copiaste{" "}
            <code className="text-foreground">valve/</code> y{" "}
            <code className="text-foreground">cstrike/</code> de Steam.
          </p>
        </header>

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
          <ul className="flex flex-col gap-1 rounded-xl bg-surface p-2">
            {checks(status).map((c) => (
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
