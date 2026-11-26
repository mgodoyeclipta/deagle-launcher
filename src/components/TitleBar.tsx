import { Target } from "@gravity-ui/icons";
import { platform } from "../lib/platform";

/**
 * Custom window title bar (the native one is disabled in tauri.conf.json).
 * Elements with `data-tauri-drag-region` move the window when dragged;
 * the buttons are left out so they stay clickable.
 */
export function TitleBar({ title }: { title: string }) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <Target className="titlebar__icon" aria-hidden="true" />
      <span className="titlebar__title" data-tauri-drag-region>
        {title}
      </span>
      <div className="titlebar__buttons">
        <button
          type="button"
          className="titlebar__button"
          aria-label="Minimizar"
          onClick={() => platform.minimize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="7" width="6" height="2" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__button"
          aria-label="Cerrar"
          onClick={() => platform.close()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
