import { useEffect, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { ArrowUpRightFromSquare, Briefcase } from "@gravity-ui/icons";
import logo from "../assets/deagle-logo.png";
import { platform } from "../lib/platform";

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
              <img src={logo} alt="" className="credits__logo" draggable={false} />
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
