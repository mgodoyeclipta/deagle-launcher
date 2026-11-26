import { Button, Drawer, Input, Label, ListBox, Select, Switch, TextField } from "@heroui/react";
import type { Key } from "@heroui/react";
import { FolderOpen } from "@gravity-ui/icons";
import type { Resolution, Settings, WindowMode } from "../lib/types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onChangeGameDir: () => void;
}

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

export function SettingsDrawer({ isOpen, onOpenChange, settings, onChange, onChangeGameDir }: Props) {
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
              </div>

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
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
