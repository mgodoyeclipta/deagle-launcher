import { useEffect, useRef, useState } from "react";
import { Alert, Button, Label, ListBox, Select, Spinner, Switch } from "@heroui/react";
import type { Key } from "@heroui/react";
import { ArrowRotateLeft, Target } from "@gravity-ui/icons";
import { platform } from "../lib/platform";
import { sfx } from "../lib/sfx";
import {
  classicRects,
  decayGap,
  DEFAULT_CROSSHAIR,
  enhancedRects,
  fromCvars,
  fromHex,
  gapAfterShot,
  PREVIEW_WEAPONS,
  restingGap,
  rgba,
  sameConfig,
  toCvars,
  toHex,
  type ClassicSize,
  type CrosshairConfig,
  type RGB,
} from "../lib/crosshair";

interface Props {
  gameDir: string;
  dataDir: string | null;
  running: boolean;
}

/** Preview as if the game ran at 1080p. */
const PREVIEW_SCREEN = { width: 1920, height: 1080 };
const PREVIEW_HEIGHT = 168;

const BACKGROUNDS = [
  { id: "dust", label: "Arena", color: "#c9b48a" },
  { id: "sky", label: "Cielo", color: "#8db3d6" },
  { id: "wall", label: "Pared", color: "#6f6a5f" },
  { id: "night", label: "Noche", color: "#1d2127" },
];

const COLOR_PRESETS: RGB[] = [
  [0, 255, 0],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 255],
];

const CLASSIC_SIZES: { id: ClassicSize; label: string }[] = [
  { id: "auto", label: "Automático" },
  { id: "small", label: "Chica" },
  { id: "medium", label: "Mediana" },
  { id: "large", label: "Grande" },
];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v: number) => String(v),
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="xhair-slider flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch isSelected={value} onChange={onChange}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: RGB; onChange: (v: RGB) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        {COLOR_PRESETS.map((preset) => {
          const selected = preset.every((v, i) => v === value[i]);
          return (
            <button
              key={preset.join()}
              type="button"
              className="color-swatch"
              data-selected={selected || undefined}
              style={{ background: rgba(preset) }}
              aria-label={`Color ${toHex(preset)}`}
              aria-pressed={selected}
              onClick={() => onChange(preset)}
            />
          );
        })}
        <input
          type="color"
          className="color-input"
          aria-label={`${label}: elegir otro color`}
          value={toHex(value)}
          onChange={(e) => onChange(fromHex(e.target.value))}
        />
      </div>
    </div>
  );
}

export function CrosshairEditor({ gameDir, dataDir, running }: Props) {
  const [saved, setSaved] = useState<CrosshairConfig | null>(null);
  const [cfg, setCfg] = useState<CrosshairConfig>(DEFAULT_CROSSHAIR);
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [weaponId, setWeaponId] = useState(PREVIEW_WEAPONS[0].id);
  const [gapUnits, setGapUnits] = useState(4);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const firing = useRef<number | null>(null);

  const weapon = PREVIEW_WEAPONS.find((w) => w.id === weaponId) ?? PREVIEW_WEAPONS[0];
  const dirty = !!saved && !sameConfig(cfg, saved);
  const minGap = restingGap(cfg, weapon);

  useEffect(() => {
    platform.readCrosshair(gameDir, dataDir).then((cvars) => {
      const loaded = fromCvars(cvars);
      setSaved(loaded);
      setCfg(loaded);
    });
  }, [gameDir, dataDir]);

  // Recoil simulation: the gap opens on each shot and closes over time,
  // exactly like the client does every frame.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setGapUnits((g) => decayGap(g, dt, minGap));
      frame = requestAnimationFrame(tick);
    };
    setGapUnits(minGap);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [minGap]);

  useEffect(() => () => stopFiring(), []);

  const update = (patch: Partial<CrosshairConfig>) => {
    setMessage(null);
    setCfg((c) => ({ ...c, ...patch }));
  };

  const shoot = () => setGapUnits((g) => gapAfterShot(g, cfg, weapon));
  function startFiring() {
    stopFiring();
    shoot();
    firing.current = window.setInterval(shoot, 100); // ~600 rpm, like an AK
  }
  function stopFiring() {
    if (firing.current !== null) window.clearInterval(firing.current);
    firing.current = null;
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await platform.writeCrosshair(gameDir, dataDir, toCvars(cfg));
      setSaved(cfg);
      setMessage({ ok: true, text: "Guardado. Se aplica la próxima vez que abras el juego." });
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
      sfx.play("deny");
    } finally {
      setSaving(false);
    }
  }

  // Preview geometry (SVG units = screen pixels of a 1080p game).
  const width = 384;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(PREVIEW_HEIGHT / 2);
  const enhanced = cfg.enabled ? enhancedRects(cfg, gapUnits, PREVIEW_SCREEN.height, cx, cy) : null;
  const classic = cfg.enabled ? [] : classicRects(cfg, PREVIEW_SCREEN.width, cx, cy);
  const color = cfg.enabled ? rgba(cfg.color, cfg.color[3]) : rgba(cfg.classicColor);
  const blend = (cfg.enabled ? cfg.additive : cfg.classicTranslucent) ? "plus-lighter" : "normal";

  if (!saved) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner color="accent" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="panel xhair-preview overflow-hidden rounded-xl" style={{ background: background.color }}>
        <svg
          viewBox={`0 0 ${width} ${PREVIEW_HEIGHT}`}
          width="100%"
          height={PREVIEW_HEIGHT}
          shapeRendering="crispEdges"
          role="img"
          aria-label="Vista previa de la mira"
        >
          {enhanced?.padding.map((r, i) => (
            <rect key={`p${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={rgba([0, 0, 0], cfg.color[3])} />
          ))}
          <g style={{ mixBlendMode: blend }}>
            {(enhanced?.bars ?? classic).map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={color} />
            ))}
          </g>
          {/* HUD colour sample, like the health/armor numbers in game */}
          <text x={10} y={PREVIEW_HEIGHT - 10} className="xhair-hud" fill={rgba(cfg.hudColor)}>
            + 100 ▪ 100
          </text>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex gap-1" role="radiogroup" aria-label="Fondo de la vista previa">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={background.id === b.id}
              aria-label={b.label}
              title={b.label}
              className="color-swatch"
              data-selected={background.id === b.id || undefined}
              style={{ background: b.color }}
              onClick={() => setBackground(b)}
            />
          ))}
        </div>
        {cfg.enabled && (
          <>
            <Select
              aria-label="Arma de ejemplo"
              className="w-32"
              value={weaponId as Key}
              onChange={(key) => key && setWeaponId(String(key))}
            >
              <Select.Trigger>
                <Select.Value className="text-xs" />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {PREVIEW_WEAPONS.map((w) => (
                    <ListBox.Item key={w.id} id={w.id} textValue={w.label}>
                      {w.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              isDisabled={cfg.dynamicScale === 0}
              onPressStart={startFiring}
              onPressEnd={stopFiring}
            >
              <Target />
              Disparar
            </Button>
          </>
        )}
      </div>
      {cfg.enabled && cfg.dynamicScale === 0 && (
        <p className="-mt-1 text-[11px] text-muted">Subí "Apertura al disparar" para ver cómo se abre la mira al disparar.</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-4 pb-2">
          <Toggle label="Mira personalizada de cs16-client" value={cfg.enabled} onChange={(enabled) => update({ enabled })} />

          {cfg.enabled ? (
            <>
              <ColorPicker
                label="Color"
                value={[cfg.color[0], cfg.color[1], cfg.color[2]]}
                onChange={([r, g, b]) => update({ color: [r, g, b, cfg.color[3]] })}
              />
              <Slider
                label="Opacidad"
                value={cfg.color[3]}
                min={0}
                max={255}
                format={(v) => `${Math.round((v / 255) * 100)}%`}
                onChange={(a) => update({ color: [cfg.color[0], cfg.color[1], cfg.color[2], a] })}
              />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Slider label="Largo" value={cfg.size} min={0} max={20} onChange={(size) => update({ size })} />
                <Slider label="Separación" value={cfg.gap} min={-5} max={15} onChange={(gap) => update({ gap })} />
                <Slider
                  label="Grosor"
                  value={cfg.thick}
                  min={0}
                  max={5}
                  step={0.5}
                  format={(v) => (v === 0 ? "1 px" : String(v))}
                  onChange={(thick) => update({ thick })}
                />
                <Slider label="Borde negro" value={cfg.pad} min={0} max={3} format={(v) => (v === 0 ? "No" : `${v} px`)} onChange={(pad) => update({ pad })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Toggle label="Punto central" value={cfg.dot} onChange={(dot) => update({ dot })} />
                <Toggle label="Forma de T" value={cfg.t} onChange={(t) => update({ t })} />
                <Toggle label="Brillo aditivo" value={cfg.additive} onChange={(additive) => update({ additive })} />
                <Toggle label="Hueco según el arma" value={cfg.useWeaponGap} onChange={(useWeaponGap) => update({ useWeaponGap })} />
              </div>
              <Slider
                label="Apertura al disparar"
                value={cfg.dynamicScale}
                min={0}
                max={2}
                step={0.1}
                format={(v) => (v === 0 ? "Fija" : `×${v.toFixed(1)}`)}
                onChange={(dynamicScale) => update({ dynamicScale })}
              />
              <Toggle
                label="Se abre al moverse, saltar o agacharse"
                value={cfg.dynamicMove}
                onChange={(dynamicMove) => update({ dynamicMove })}
              />
            </>
          ) : (
            <>
              <ColorPicker label="Color" value={cfg.classicColor} onChange={(classicColor) => update({ classicColor })} />
              <Select
                className="w-full"
                value={cfg.classicSize as Key}
                onChange={(key) => key && update({ classicSize: key as ClassicSize })}
              >
                <Label>Tamaño</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {CLASSIC_SIZES.map((s) => (
                      <ListBox.Item key={s.id} id={s.id} textValue={s.label}>
                        {s.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Toggle label="Translúcida" value={cfg.classicTranslucent} onChange={(classicTranslucent) => update({ classicTranslucent })} />
              <Toggle label="Dinámica" value={cfg.classicDynamic} onChange={(classicDynamic) => update({ classicDynamic })} />
            </>
          )}

          <div className="border-t border-border pt-3">
            <ColorPicker label="Color del HUD (vida, chaleco, munición)" value={cfg.hudColor} onChange={(hudColor) => update({ hudColor })} />
          </div>
        </div>
      </div>

      {message && (
        <Alert status={message.ok ? "success" : "danger"}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{message.text}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" isDisabled={!dirty || running} isPending={saving} onPress={save}>
          {running ? "Cerrá el juego para guardar" : dirty ? "Guardar en el juego" : "Sin cambios"}
        </Button>
        <Button
          isIconOnly
          variant="secondary"
          aria-label="Deshacer cambios"
          isDisabled={!dirty}
          onPress={() => {
            setCfg(saved);
            setMessage(null);
          }}
        >
          <ArrowRotateLeft />
        </Button>
        <Button
          variant="tertiary"
          onPress={() => {
            setCfg({ ...DEFAULT_CROSSHAIR, enabled: cfg.enabled, hudColor: cfg.hudColor });
            setMessage(null);
          }}
        >
          Por defecto
        </Button>
      </div>
    </div>
  );
}
