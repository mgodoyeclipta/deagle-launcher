import type { MonitorInfo } from "../lib/types";

interface Props {
  monitors: MonitorInfo[];
  selected: number;
  supported: boolean;
  onSelect: (index: number) => void;
}

const BOX_HEIGHT = 112;

/** Draws the monitors with their real macOS arrangement; click one to pick it. */
export function MonitorPicker({ monitors, selected, supported, onSelect }: Props) {
  if (monitors.length === 0) return null;

  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));
  const totalW = maxX - minX;
  const totalH = maxY - minY;
  const aspect = totalW / totalH;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Monitor</p>
        {monitors.length > 1 && (
          <p className="text-xs text-muted">{monitors[selected]?.name ?? ""}</p>
        )}
      </div>

      <div className="flex justify-center rounded-xl bg-surface p-3">
        <div className="relative" style={{ height: BOX_HEIGHT, width: BOX_HEIGHT * aspect, maxWidth: "100%" }}>
          {monitors.map((m) => {
            const isSelected = m.index === selected;
            return (
              <button
                key={m.index}
                type="button"
                onClick={() => onSelect(m.index)}
                aria-pressed={isSelected}
                aria-label={`${m.name}, ${m.width} por ${m.height}`}
                className={[
                  "absolute flex flex-col items-center justify-center gap-0.5 rounded-md border-2 text-center transition-colors",
                  "outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  isSelected
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-border bg-default text-muted hover:border-muted hover:text-foreground",
                ].join(" ")}
                style={{
                  left: `${((m.x - minX) / totalW) * 100}%`,
                  top: `${((m.y - minY) / totalH) * 100}%`,
                  width: `calc(${(m.width / totalW) * 100}% - 4px)`,
                  height: `calc(${(m.height / totalH) * 100}% - 4px)`,
                }}
              >
                <span className="text-sm font-semibold">{m.index + 1}</span>
                <span className="text-[11px] leading-none">
                  {m.width}×{m.height}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!supported && monitors.length > 1 && (
        <p className="text-xs text-warning">
          Tu versión de Xash3D todavía no permite elegir monitor: el juego abre en la pantalla
          principal. Tu elección queda guardada para cuando actualices el motor.
        </p>
      )}
    </div>
  );
}
