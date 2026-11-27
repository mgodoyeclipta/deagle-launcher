import { useEffect, useState } from "react";
import { Alert, Button, Modal } from "@heroui/react";
import { ArrowUpRightFromSquare, Briefcase } from "@gravity-ui/icons";
import logo from "../assets/deagle-logo.png";
import { platform } from "../lib/platform";
import { sfx } from "../lib/sfx";

/** Clicks on the logo that reveal the hidden factory reset. */
const SECRET_CLICKS = 5;

const AUTHOR = {
  name: "Matias Godoy",
  message:
    "Espero que con este launcher puedas volver a jugar eso que tanto amabas de chico, nos vemos en d2 :)",
  portfolio: "https://www.matigodoy.com.ar/",
  linkedin: "https://www.linkedin.com/in/matigodoy/",
  repo: "https://github.com/mgodoyeclipta/deagle-launcher",
};

/** Open-source projects the launcher runs on top of. */
const THANKS = [
  { name: "Xash3D FWGS", by: "equipo FWGS", url: "https://github.com/FWGS/xash3d-fwgs" },
  { name: "cs16-client", by: "Velaron, a1batross y colaboradores", url: "https://github.com/Velaron/cs16-client" },
  { name: "YaPB", by: "jeefo y colaboradores", url: "https://github.com/yapb/yapb" },
  { name: "ReGameDLL_CS", by: "colaboradores de ReHLDS", url: "https://github.com/rehlds/ReGameDLL_CS" },
];

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Credits({ isOpen, onOpenChange }: Props) {
  const [version, setVersion] = useState("");
  const [logoClicks, setLogoClicks] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetUnlocked = logoClicks >= SECRET_CLICKS;

  // Hide it again whenever the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      setLogoClicks(0);
      setConfirming(false);
      setResetError(null);
    }
  }, [isOpen]);

  async function factoryReset() {
    setResetting(true);
    setResetError(null);
    try {
      await platform.factoryReset();
    } catch (e) {
      setResetError(String(e));
      sfx.play("deny");
      setResetting(false);
    }
  }

  useEffect(() => {
    platform.appVersion().then(setVersion).catch(() => {});
  }, []);

  const open = (url: string) => platform.openUrl(url);

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="credits sm:max-w-[380px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <img
                src={logo}
                alt=""
                className="credits__logo"
                draggable={false}
                onClick={() => setLogoClicks((n) => n + 1)}
              />
              <Modal.Heading>Deagle Launcher{version && ` v${version}`}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">Hecho por</p>
                <p className="credits__author text-lg font-semibold">{AUTHOR.name}</p>
                <blockquote className="credits__message text-sm leading-relaxed">“{AUTHOR.message}”</blockquote>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onPress={() => open(AUTHOR.portfolio)}>
                    <Briefcase />
                    Portfolio
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => open(AUTHOR.linkedin)}>
                    <ArrowUpRightFromSquare />
                    LinkedIn
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => open(AUTHOR.repo)}>
                    <ArrowUpRightFromSquare />
                    GitHub
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <p className="text-xs text-muted">Gracias a</p>
                <ul className="flex flex-col gap-1">
                  {THANKS.map((t) => (
                    <li key={t.name} className="text-xs">
                      <button type="button" className="credits__link" onClick={() => open(t.url)}>
                        {t.name}
                      </button>{" "}
                      <span className="text-muted">— {t.by}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {resetUnlocked && !confirming && (
                <Button size="sm" variant="danger-soft" className="self-start" onPress={() => setConfirming(true)}>
                  Restablecer Deagle Launcher…
                </Button>
              )}

              {confirming && (
                <Alert status="danger" className="factory-reset">
                  <Alert.Indicator />
                  <Alert.Content className="flex flex-col gap-2">
                    <Alert.Title>¿Restablecer de fábrica?</Alert.Title>
                    <Alert.Description>
                      Se borra todo lo del launcher y vuelve como recién instalado:
                    </Alert.Description>
                    <ul className="list-disc pl-4 text-xs">
                      <li>tus ajustes (carpeta, tema, favoritos, monitor, sonidos…)</li>
                      <li>la instalación oficial del motor y cs16-client</li>
                      <li>los registros del launcher</li>
                    </ul>
                    <p className="text-xs">
                      No se toca: Steam, tu Counter-Strike de Steam ni tus carpetas propias de Xash3D (con sus
                      configs y miras).
                    </p>
                    {resetError && <p className="text-xs font-semibold">{resetError}</p>}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="danger" isPending={resetting} onPress={factoryReset}>
                        Borrar todo y reiniciar
                      </Button>
                      <Button size="sm" variant="tertiary" isDisabled={resetting} onPress={() => setConfirming(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </Alert.Content>
                </Alert>
              )}

              <p className="text-[11px] leading-snug text-muted">
                Proyecto independiente y gratuito, sin afiliación con Valve Corporation ni Magnum Research.
                Counter-Strike, Half-Life y Steam son marcas de Valve Corporation; Desert Eagle es marca de
                Magnum Research, Inc. Licencia GPL-3.0-or-later.
              </p>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
