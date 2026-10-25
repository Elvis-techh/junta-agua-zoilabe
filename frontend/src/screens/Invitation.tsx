import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { PinField } from "../components/PinField.tsx";

type Step =
  | { kind: "checking" }
  | { kind: "invalid"; message: string }
  | { kind: "welcome"; name: string; roleName: string; replacesPin: boolean }
  | { kind: "pin"; first: string }
  | { kind: "repeat"; first: string; second: string }
  | { kind: "done" };

/**
 * Opening the invitation link: one question per screen. Welcome → choose a
 * PIN → type it again → done, with how to add the app to the home screen.
 */
export function InvitationScreen({ onDone }: { onDone: () => void }) {
  const token = window.location.hash.slice(1);
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const [welcome, setWelcome] = useState<{ name: string; replacesPin: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string; roleName: string; replacesPin: boolean }>("POST", "/auth/invitation/check", { token })
      .then((data) => {
        setWelcome(data);
        setStep({ kind: "welcome", ...data });
      })
      .catch((err: Error) => setStep({ kind: "invalid", message: err.message }));
  }, [token]);

  const accept = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/invitation/accept", { token, pin });
      setStep({ kind: "done" });
    } catch (err) {
      setError((err as Error).message);
      setStep({ kind: "pin", first: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen centered stack">
      {step.kind === "checking" && <p className="muted">Revisando su invitación…</p>}

      {step.kind === "invalid" && <p className="message error">{step.message}</p>}

      {step.kind === "welcome" && (
        <>
          <h1>Bienvenido, {step.name}</h1>
          <p>
            Usted entra como <strong>{step.roleName}</strong> de la Junta de Agua de Zoilabe.
          </p>
          <p>
            {step.replacesPin
              ? "Ahora va a elegir un PIN nuevo de 6 números."
              : "Ahora va a elegir un PIN de 6 números. Lo usará cada vez que abra la app, igual que los códigos de WhatsApp."}
          </p>
          <button className="btn go block" onClick={() => setStep({ kind: "pin", first: "" })}>
            Continuar
          </button>
        </>
      )}

      {step.kind === "pin" && (
        <>
          <h1>Elija su PIN</h1>
          <PinField
            label="6 números que usted recuerde"
            value={step.first}
            onChange={(first) => setStep({ kind: "pin", first })}
            autoFocus
            isNew
          />
          {error && <p className="message error">{error}</p>}
          <button
            className="btn go block"
            disabled={step.first.length !== 6}
            onClick={() => setStep({ kind: "repeat", first: step.first, second: "" })}
          >
            Siguiente
          </button>
        </>
      )}

      {step.kind === "repeat" && (
        <>
          <h1>Escríbalo otra vez</h1>
          <PinField
            label="El mismo PIN, para confirmar"
            value={step.second}
            onChange={(second) => setStep({ ...step, second })}
            autoFocus
            isNew
          />
          {step.second.length === 6 && step.second !== step.first && (
            <p className="message error">Los dos PIN no son iguales. Revise e intente de nuevo.</p>
          )}
          <button
            className="btn go block"
            disabled={step.second !== step.first || busy}
            onClick={() => void accept(step.first)}
          >
            Guardar mi PIN
          </button>
          <button className="btn block" onClick={() => setStep({ kind: "pin", first: "" })}>
            Empezar de nuevo
          </button>
        </>
      )}

      {step.kind === "done" && (
        <>
          <p className="message ok">Guardado. Este teléfono ya queda registrado{welcome ? `, ${welcome.name}` : ""}.</p>
          <p>
            Para tener la app a mano: en el menú del navegador toque <strong>«Agregar a la pantalla de inicio»</strong>{" "}
            (o «Instalar app»).
          </p>
          <button className="btn go block" onClick={onDone}>
            Entrar a la app
          </button>
        </>
      )}
    </main>
  );
}
