# Deagle Launcher

Launcher de escritorio para jugar Counter-Strike 1.6 con [Xash3D FWGS](https://github.com/FWGS/xash3d-fwgs) y [cs16-client](https://github.com/Velaron/cs16-client) en macOS (Apple Silicon).

Hecho con Tauri 2 (Rust) + React 19 + Vite + Tailwind v4 + HeroUI v3.

> **Deagle Launcher no incluye ni descarga el juego.** Necesitás tener [Counter-Strike en Steam](https://store.steampowered.com/app/10/CounterStrike/) y copiar tus propias carpetas `valve/` y `cstrike/` a la carpeta de Xash3D, como indica cs16-client.

## Qué hace (v0.1 — modo "juego rápido")

- **Primera vez:** elegís la carpeta de Xash3D con el diálogo nativo y chequea motor, permisos, cuarentena de macOS, `valve/`, `cstrike/` y cs16-client. Botón para arreglar permisos y cuarentena.
- **Pantalla principal:**
  - Tu nombre (se escribe en `cstrike/config.cfg` antes de lanzar).
  - Selector visual de monitor con la disposición real de tus pantallas.
  - **Continuar**: conecta al último servidor (`+connect`), elegible entre el historial del juego (`history_servers.lst`).
  - **Práctica con bots**: partida local con YaPB (`-dll @yapb +map … +yb_quota N`) en un mapa al azar.
  - **Abrir juego**: va al menú normal.
- **Ajustes:** carpeta, modo (sin bordes / pantalla completa / ventana), resolución, cantidad de bots, argumentos extra, minimizar al jugar.
- Mientras jugás el launcher se minimiza y vuelve al cerrar el juego. Si el juego crashea, muestra el final del log (`~/Library/Logs/com.mgodoy.deaglelauncher/game.log`).

### Temas y sonidos

- **Clásico** (por defecto): homenaje a la interfaz de Steam/HLDS de 2003–2004 — verde oliva, bordes biselados, Tahoma, barra de título propia con `_` y `X`. También hay un tema **Moderno**.
- **Sonidos clásicos** de Half-Life y Counter-Strike al hacer click (menú de HL, disparo de Deagle en *Continuar*, "Lock 'n load" en *Práctica con bots*, "Let's go" en *Abrir juego*…). Se leen en tiempo de ejecución desde **tu** carpeta del juego (`valve/sound`, `cstrike/sound`) y nunca se incluyen en el launcher. Se pueden apagar o bajar en Ajustes.

### Elegir monitor

El selector pasa `-display N` al motor, pero el Xash3D FWGS actual **no soporta** ese argumento: siempre abre en la pantalla principal. El launcher lo detecta y avisa. Falta un parche chico al motor (`VID_CreateWindow` en `engine/platform/sdl2/vid_sdl2.c`, usando `SDL_WINDOWPOS_CENTERED_DISPLAY(n)`).

## Desarrollo

Requisitos: Rust (rustup), Node 20+, Xcode Command Line Tools.

```bash
npm install
npm run tauri dev      # app nativa con recarga en caliente
npm run dev            # solo la UI en el navegador, con datos simulados
npm run tauri build    # genera Deagle Launcher.app y .dmg
```

En el navegador (`npm run dev`) la app usa una simulación (`src/lib/platform.ts`). Agregá `?crash` a la URL para simular un crash del juego.

Tests del backend:

```bash
cd src-tauri && cargo test
```

## Estructura

```
src/                     React
  App.tsx                fases: cargando → configuración → principal
  components/            SetupScreen, MainScreen, MonitorPicker, SettingsDrawer
  lib/platform.ts        puente a Tauri (o simulación en navegador)
  lib/types.ts           tipos compartidos con Rust
src-tauri/src/           Rust
  game.rs                chequeo de carpeta, config.cfg, servidores, mapas
  launch.rs              armado de argumentos, lanzar xash3d, evento al salir
  commands.rs            comandos expuestos a React con invoke()
```

## Aviso legal

Deagle Launcher es un proyecto independiente y gratuito, **sin afiliación ni respaldo de Valve Corporation ni de Magnum Research**.

- Counter-Strike, Half-Life, Steam y sus logos son marcas registradas de Valve Corporation.
- Desert Eagle es una marca registrada de Magnum Research, Inc. "Deagle" se usa solo como apodo popular del arma dentro del juego.
- Este repositorio no contiene ni distribuye archivos del juego (mapas, modelos, sonidos, texturas, sprites ni íconos de Valve). El launcher solo lee los archivos que cada usuario copió de su propia compra en Steam. Eso incluye los efectos de sonido de la interfaz: se leen desde la instalación del usuario.
- Xash3D FWGS (GPL-3.0), cs16-client (GPL-2.0+ con excepción para el motor de Half-Life, más la licencia del Half-Life SDK) y YaPB (MIT) son proyectos de terceros con sus propias licencias. Este launcher no los incluye: los ejecuta desde la carpeta del usuario.

## Licencia

Deagle Launcher es software libre bajo la [GNU General Public License v3.0](LICENSE) o posterior (`GPL-3.0-or-later`).
