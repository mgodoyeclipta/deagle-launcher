/** Builds the Discord Rich Presence text for the current game session. */
import { platform } from "./platform";
import { cleanName } from "./servers";
import type { LaunchAction, Presence } from "./types";

export interface Session {
  action: LaunchAction;
  /** Unix milliseconds when the game was launched. */
  startedAt: number;
}

export async function presenceFor(session: Session): Promise<Presence> {
  const { action, startedAt } = session;
  switch (action.kind) {
    case "connect": {
      const [status] = await platform.queryServers([action.address]).catch(() => []);
      const info = status?.info;
      if (!info) return { details: "Counter-Strike 1.6 · Online", startedAt };
      return {
        details: `Counter-Strike 1.6 · ${info.map} · ${info.players}/${info.maxPlayers}`,
        state: cleanName(info.name) || undefined,
        startedAt,
      };
    }
    case "bots":
      return {
        details: `Counter-Strike 1.6 · ${action.map}`,
        state: `Práctica con ${action.count} bots`,
        startedAt,
      };
    case "menu":
      return { details: "Counter-Strike 1.6", state: "En el menú principal", startedAt };
  }
}
