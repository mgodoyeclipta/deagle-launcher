import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Spinner, TextField } from "@heroui/react";
import { ArrowRotateRight, ArrowUpRightFromSquare, Lock, Play, Plus, Star, StarFill } from "@gravity-ui/icons";
import { platform } from "../lib/platform";
import {
  argentinaServers,
  cleanName,
  formatDuration,
  GAMETRACKER_ARGENTINA,
  gametrackerUrl,
  isValidAddress,
  internetServers,
  pingLevel,
  type ServerSource,
} from "../lib/servers";
import type { PlayerInfo, ServerStatus, Settings } from "../lib/types";

interface Props {
  settings: Settings;
  running: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onConnect: (address: string) => void;
}

const SOURCES: { id: ServerSource; label: string }[] = [
  { id: "argentina", label: "Argentina" },
  { id: "internet", label: "Internet" },
  { id: "history", label: "Historial" },
  { id: "favorites", label: "Favoritos" },
];

type SortKey = "players" | "ping" | "name";

const SORT_LABELS: Record<SortKey, string> = { players: "Jugadores", ping: "Ping", name: "Nombre" };

/** Lowercase without accents, so "publico" finds "PÚBLICO". */
const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const REFRESH_MS = 30_000;

export function ServerBrowser({ settings, running, onChange, onConnect }: Props) {
  const [source, setSource] = useState<ServerSource>("argentina");
  const [statuses, setStatuses] = useState<ServerStatus[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [sort, setSort] = useState<SortKey>("players");
  const [query, setQuery] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hideFull, setHideFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const requestId = useRef(0);

  const favorites = settings.favorites;

  const addressesFor = useCallback(
    async (src: ServerSource): Promise<string[]> => {
      switch (src) {
        case "argentina": {
          const list = await argentinaServers();
          setNames(Object.fromEntries(list.filter((s) => s.name).map((s) => [s.address, s.name!])));
          return list.map((s) => s.address);
        }
        case "internet":
          return internetServers();
        case "history":
          return settings.gameDir ? platform.recentServers(settings.gameDir) : [];
        case "favorites":
          return favorites;
      }
    },
    [settings.gameDir, favorites],
  );

  const refresh = useCallback(
    async (src: ServerSource = source) => {
      const id = ++requestId.current;
      setLoading(true);
      setListError(null);
      try {
        const addresses = await addressesFor(src);
        const result = addresses.length ? await platform.queryServers(addresses) : [];
        if (id !== requestId.current) return; // a newer refresh won
        setStatuses(result);
        setUpdatedAt(new Date());
      } catch (e) {
        if (id === requestId.current) {
          setStatuses([]);
          setListError(String(e instanceof Error ? e.message : e));
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [source, addressesFor],
  );

  // Load on source change, then keep it fresh while you're not playing.
  useEffect(() => {
    setSelected(null);
    setStatuses([]);
    refresh(source);
  }, [source]);

  useEffect(() => {
    if (running) return;
    const timer = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, running]);

  // Favourites list follows starring/unstarring live.
  useEffect(() => {
    if (source === "favorites") refresh("favorites");
  }, [favorites]);

  useEffect(() => {
    setPlayers(null);
    setPlayersError(null);
    if (!selected) return;
    const online = statuses.find((s) => s.address === selected)?.info;
    if (!online) return;
    let cancelled = false;
    platform
      .queryPlayers(selected)
      .then((list) => !cancelled && setPlayers([...list].sort((a, b) => b.score - a.score)))
      .catch((e) => !cancelled && setPlayersError(String(e)));
    return () => {
      cancelled = true;
    };
    // Re-query players when the list refreshes, not on every status object change.
  }, [selected, updatedAt]);

  const rows = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const label = (s: ServerStatus) => (s.info ? cleanName(s.info.name) : (names[s.address] ?? ""));
    const matches = (s: ServerStatus) => {
      if (!words.length) return true;
      const haystack = fold(`${label(s)} ${s.info?.map ?? ""} ${s.address}`);
      return words.every((w) => haystack.includes(w));
    };
    const visible = statuses.filter((s) => {
      if (!matches(s)) return false;
      if (hideEmpty && (!s.info || s.info.players === 0)) return false;
      if (hideFull && s.info && s.info.players >= s.info.maxPlayers) return false;
      return true;
    });
    const online = visible.filter((s) => s.info);
    const offline = visible.filter((s) => !s.info);
    online.sort((a, b) => {
      if (sort === "ping") return a.info!.pingMs - b.info!.pingMs;
      if (sort === "name") return label(a).localeCompare(label(b), "es", { sensitivity: "base" });
      return b.info!.players - a.info!.players || a.info!.pingMs - b.info!.pingMs;
    });
    return [...online, ...offline];
  }, [statuses, sort, query, hideEmpty, hideFull, names]);

  const current = statuses.find((s) => s.address === selected) ?? null;
  const isFavorite = !!selected && favorites.includes(selected);

  const [newFavorite, setNewFavorite] = useState("");
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  /** "1.2.3.4" → "1.2.3.4:27015"; trims spaces and a leading "connect ". */
  function normalizeAddress(raw: string): string {
    const text = raw.trim().replace(/^connect\s+/i, "").replace(/\s+/g, "");
    return /:\d+$/.test(text) ? text : `${text}:27015`;
  }

  function addFavorite() {
    const address = normalizeAddress(newFavorite);
    if (!newFavorite.trim() || !isValidAddress(address)) {
      setFavoriteError("Escribí una IP o dominio, por ejemplo 45.235.98.52:27038");
      return;
    }
    if (favorites.includes(address)) {
      setFavoriteError("Ese servidor ya está en tus favoritos");
      return;
    }
    onChange({ favorites: [...favorites, address] });
    setNewFavorite("");
    setFavoriteError(null);
    setSelected(address);
  }

  function toggleFavorite(address: string) {
    onChange({
      favorites: favorites.includes(address)
        ? favorites.filter((f) => f !== address)
        : [...favorites, address],
    });
  }

  const displayName = (s: ServerStatus) =>
    s.info ? cleanName(s.info.name) || s.address : (names[s.address] ?? s.address);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1" role="tablist" aria-label="Lista de servidores">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={source === s.id}
            data-selected={source === s.id || undefined}
            className="source-tab"
            onClick={() => setSource(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {source === "favorites" && (
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addFavorite();
          }}
        >
          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              value={newFavorite}
              onChange={(v) => {
                setNewFavorite(v);
                setFavoriteError(null);
              }}
              aria-label="IP del servidor"
              isInvalid={!!favoriteError}
            >
              <Input placeholder="IP del servidor (ej. 45.235.98.52:27038)" className="font-mono text-xs" />
            </TextField>
            <Button type="submit" size="sm" variant="secondary">
              <Plus />
              Agregar
            </Button>
          </div>
          {favoriteError && <p className="text-xs text-danger">{favoriteError}</p>}
        </form>
      )}

      <TextField value={query} onChange={setQuery} aria-label="Buscar servidor">
        <Input placeholder="Buscar por nombre, mapa o IP (ej. dust2, automix)" className="text-xs" />
      </TextField>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <div className="flex items-center gap-2">
          <span>Ordenar:</span>
          {(["players", "ping", "name"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className="sort-link"
              data-selected={sort === key || undefined}
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span>{updatedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          <Button isIconOnly size="sm" variant="ghost" aria-label="Actualizar" isPending={loading} onPress={() => refresh()}>
            {({ isPending }) => (isPending ? <Spinner size="sm" color="current" /> : <ArrowRotateRight />)}
          </Button>
        </div>
      </div>

      <div className="-mt-1 flex items-center gap-2 text-xs text-muted">
        <span>Ocultar:</span>
        <button type="button" className="sort-link" data-selected={hideEmpty || undefined} aria-pressed={hideEmpty} onClick={() => setHideEmpty((v) => !v)}>
          vacíos
        </button>
        <button type="button" className="sort-link" data-selected={hideFull || undefined} aria-pressed={hideFull} onClick={() => setHideFull((v) => !v)}>
          llenos
        </button>
        {statuses.length > 0 && (
          <span className="ml-auto tabular-nums">
            {rows.length === statuses.length ? `${statuses.length} servidores` : `${rows.length} de ${statuses.length}`}
          </span>
        )}
      </div>

      <div className="panel server-list min-h-[132px] flex-1 overflow-y-auto rounded-xl bg-surface p-1" role="listbox" aria-label="Servidores">
        {rows.map((s) => {
          const info = s.info;
          const isSelected = s.address === selected;
          return (
            <button
              key={s.address}
              type="button"
              role="option"
              aria-selected={isSelected}
              data-selected={isSelected || undefined}
              data-offline={!info || undefined}
              data-sfx="select"
              className="server-row"
              onClick={() => setSelected(s.address)}
              onDoubleClick={() => info && !running && onConnect(s.address)}
            >
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="flex w-full min-w-0 items-center gap-1">
                  {info?.password && <Lock className="size-3 shrink-0" aria-label="Con contraseña" />}
                  <span className="truncate text-sm">{displayName(s)}</span>
                </span>
                <span className="truncate text-xs text-muted">{info ? info.map : (s.error ?? "Sin respuesta")}</span>
              </span>
              {info && (
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-sm tabular-nums">
                    {info.players}/{info.maxPlayers}
                  </span>
                  <span className="text-xs tabular-nums" data-ping={pingLevel(info.pingMs)}>
                    {info.pingMs} ms
                  </span>
                </span>
              )}
            </button>
          );
        })}

        {!loading && rows.length === 0 && (
          <p className="p-4 text-center text-xs text-muted">
            {listError ??
              (statuses.length > 0 ? "Ningún servidor coincide con la búsqueda." : null) ??
              (source === "favorites"
                ? "Agregá un servidor con su IP, o marcá cualquiera con la estrella."
                : source === "history"
                  ? "Todavía no hay servidores en tu historial."
                  : "No se encontraron servidores.")}
          </p>
        )}
      </div>

      {source === "argentina" && (
        <Button size="sm" variant="secondary" fullWidth onPress={() => platform.openUrl(GAMETRACKER_ARGENTINA)}>
          <ArrowUpRightFromSquare />
          Más servidores de Argentina en GameTracker
        </Button>
      )}

      {current && (
        <div className="panel server-detail flex flex-col gap-2 rounded-xl bg-surface p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={current.info ? cleanName(current.info.name) : current.address}>
              {displayName(current)}
            </p>
            <p className="truncate font-mono text-xs text-muted select-text">
              {current.address}
              {current.info && ` · ${current.info.map} · ${current.info.players}/${current.info.maxPlayers}`}
              {!!current.info?.bots && ` (${current.info.bots} bots)`}
            </p>
          </div>

          {current.info && (
            <div className="player-list max-h-28 overflow-y-auto text-xs">
              {players === null && !playersError && <p className="text-muted">Cargando jugadores…</p>}
              {playersError && <p className="text-muted">No se pudo leer la lista de jugadores.</p>}
              {players?.length === 0 && <p className="text-muted">No hay nadie jugando.</p>}
              {players && players.length > 0 && (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col />
                    <col className="w-10" />
                    <col className="w-20" />
                  </colgroup>
                  <tbody>
                    {players.map((p, i) => (
                      <tr key={`${p.name}-${i}`}>
                        <td className="truncate py-0.5 pr-2">{cleanName(p.name) || "(sin nombre)"}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums">{p.score}</td>
                        <td className="py-0.5 text-right whitespace-nowrap text-muted">{formatDuration(p.durationSecs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              data-sfx="connect"
              isDisabled={running || !current.info}
              onPress={() => onConnect(current.address)}
            >
              <Play />
              Conectar
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="secondary"
              aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
              onPress={() => toggleFavorite(current.address)}
            >
              {isFavorite ? <StarFill /> : <Star />}
            </Button>
            <Button size="sm" variant="secondary" onPress={() => platform.openUrl(gametrackerUrl(current.address))}>
              <ArrowUpRightFromSquare />
              GameTracker
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
