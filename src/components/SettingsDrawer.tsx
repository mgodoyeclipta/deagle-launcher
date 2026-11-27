import { Button, Drawer, Input, Label, ListBox, Select, Spinner, Switch, TextField } from "@heroui/react";
import type { Key } from "@heroui/react";
import { ArrowUpRightFromSquare, CircleCheck, CircleExclamation, FolderOpen } from "@gravity-ui/icons";
import { platform } from "../lib/platform";
import type { ComponentUpdate, UpdateReport } from "../lib/updates";
import type { Resolution, Settings, Skin, SteamStatus, WindowMode } from "../lib/types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onChangeGameDir: () => void;
  discordAvailable: boolean;
  steam: SteamStatus | null;
  updates: UpdateReport | null;
  checkingUpdates: boolean;
  onCheckUpdates: () => void;
  onShowCredits: () => void;
}

const SKINS: { id: Skin; label: string }[] = [
  { id: "classic", label: "Clásico (estilo 2004)" },
  { id: "modern", label: "Moderno" },
];

const WINDOW_MODES: { id: WindowMode; label: string }[] = [
  { id: "borderless", label: "Pantalla completa sin bordes" },
  { id: "fullscreen", label: "Pantalla completa" },
  { id: "windowed", label: "Ventana" },
];

const RESOLUTIONS: { id: Resolution; label: string }[] = [
  { id: "native", label: "La del monitor" },
  { id: "1920x1080", label: "1920 × 1080" },
  { id: "1600x900", label: "1600 × 900" },
  { id: "1280x720", label: "1280 × 720" },
  { id: "1024x768", label: "1024 × 768 (4:3)" },
  { id: "800x600", label: "800 × 600 (4:3)" },
];

const BOT_COUNTS = [3, 5, 9, 15, 19, 31];

const VOLUMES = [
  { id: 30, label: "Bajo" },
  { id: 60, label: "Medio" },
  { id: 100, label: "Alto" },
];

function SimpleSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select
      variant="secondary"
      className="w-full"
      value={value as Key}
      onChange={(key) => {
        const match = options.find((o) => String(o.id) === String(key));
        if (match) onChange(match.id);
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={String(o.id)} id={o.id as Key} textValue={o.label}>
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function UpdateRow({ label, update }: { label: string; update: ComponentUpdate }) {
  return (
    <li className="flex items-start gap-2">
      {update.available ? (
        <CircleExclamation className="mt-0.5 size-4 shrink-0 text-warning" />
      ) : (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted">
          {update.current ?? "Versión desconocida"}
          {update.available ? ` → ${update.latest}` : update.error ? "" : " · al día"}
        </p>
        {update.error && <p className="text-xs text-muted">{update.error}</p>}
      </div>
      {update.available && (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={`Ver actualización de ${label}`}
          onPress={() => platform.openUrl(update.url)}
        >
          <ArrowUpRightFromSquare />
        </Button>
      )}
    </li>
  );
}

export function SettingsDrawer({
  isOpen,
  onOpenChange,
  settings,
  onChange,
  onChangeGameDir,
  discordAvailable,
  steam,
  updates,
  checkingUpdates,
  onCheckUpdates,
  onShowCredits,
}: Props) {
  return (
    <Drawer>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>Ajustes</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Carpeta del juego</p>
                <p className="truncate text-xs text-muted" title={settings.gameDir ?? ""}>
                  {settings.gameDir}
                </p>
                <Button variant="secondary" size="sm" onPress={onChangeGameDir}>
                  <FolderOpen />
                  Cambiar carpeta
                </Button>
                {steam?.dataDir && (
                  <Switch
                    isSelected={settings.dataDir === steam.dataDir}
                    onChange={(on) => onChange({ dataDir: on ? steam.dataDir : null })}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      Usar los archivos del juego de Steam
                    </Switch.Content>
                  </Switch>
                )}
              </div>

              <SimpleSelect
                label="Tema"
                value={settings.skin}
                options={SKINS}
                onChange={(skin) => onChange({ skin })}
              />

              <SimpleSelect
                label="Modo de pantalla"
                value={settings.windowMode}
                options={WINDOW_MODES}
                onChange={(windowMode) => onChange({ windowMode })}
              />

              <SimpleSelect
                label="Resolución"
                value={settings.resolution}
                options={RESOLUTIONS}
                onChange={(resolution) => onChange({ resolution })}
              />

              <SimpleSelect
                label="Bots en práctica"
                value={settings.botCount}
                options={BOT_COUNTS.map((n) => ({ id: n, label: `${n} bots` }))}
                onChange={(botCount) => onChange({ botCount })}
              />

              <TextField
                value={settings.extraArgs}
                onChange={(extraArgs) => onChange({ extraArgs })}
              >
                <Label>Argumentos extra</Label>
                <Input variant="secondary" placeholder="-dev 2 -log" className="font-mono text-xs" />
              </TextField>

              <Switch
                isSelected={settings.minimizeOnLaunch}
                onChange={(minimizeOnLaunch) => onChange({ minimizeOnLaunch })}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  Minimizar el launcher al jugar
                </Switch.Content>
              </Switch>

              <Switch isSelected={settings.sounds} onChange={(sounds) => onChange({ sounds })}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  Sonidos clásicos de HL y CS
                </Switch.Content>
              </Switch>

              {settings.sounds && (
                <SimpleSelect
                  label="Volumen de los sonidos"
                  value={settings.volume}
                  options={VOLUMES}
                  onChange={(volume) => onChange({ volume })}
                />
              )}
              {discordAvailable && (
                <Switch
                  isSelected={settings.discordPresence}
                  onChange={(discordPresence) => onChange({ discordPresence })}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    Mostrar en Discord a qué estoy jugando
                  </Switch.Content>
                </Switch>
              )}

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Actualizaciones</p>
                  <Button size="sm" variant="secondary" isPending={checkingUpdates} onPress={onCheckUpdates}>
                    {({ isPending }) => (isPending ? <Spinner size="sm" color="current" /> : "Buscar ahora")}
                  </Button>
                </div>
                {updates ? (
                  <ul className="flex flex-col gap-2">
                    <UpdateRow label="Deagle Launcher" update={updates.launcher} />
                    <UpdateRow label="Motor Xash3D FWGS" update={updates.engine} />
                    <UpdateRow label="cs16-client" update={updates.client} />
                  </ul>
                ) : (
                  <p className="text-xs text-muted">{checkingUpdates ? "Buscando…" : "Todavía no se buscaron."}</p>
                )}
                <p className="text-[11px] leading-snug text-muted">
                  Solo avisa y abre la página oficial: el launcher no descarga ni reemplaza archivos del juego.
                </p>
              </div>

              <Button variant="tertiary" size="sm" className="self-start" onPress={onShowCredits}>
                Créditos
              </Button>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
