import { useState } from "react";

import { ApiError, api } from "../api.ts";
import { PinField } from "../components/PinField.tsx";
import { Icon } from "../icons.tsx";

/** A remembered phone: type the PIN to enter. */
export function PinScreen({ name, locked, onSignedIn }: { name: string; locked: boolean; onSignedIn: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(locked);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/pin", { pin: value });
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "account_locked") {
        setIsLocked(true);
      }
      setError((err as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (isLocked) {
    return (
      <main className="screen centered stack">
        <h1>Hola, {name}</h1>
        <p className="message error">
          <Icon name="lock" /> Su cuenta está bloqueada por seguridad. Llame al administrador para desbloquearla.
        </p>
      </main>
    );
  }

  return (
    <main className="screen centered stack">
      <h1>Hola, {name}</h1>
      <PinField
        label="Escriba su PIN"
        value={pin}
        onChange={(value) => {
          setPin(value);
          if (value.length === 6 && !busy) void submit(value);
        }}
        autoFocus
      />
      {error && <p className="message error">{error}</p>}
      <button className="btn go block" disabled={pin.length !== 6 || busy} onClick={() => void submit(pin)}>
        Entrar
      </button>
      <p className="muted">¿Olvidó su PIN? Pida al administrador una invitación nueva.</p>
    </main>
  );
}
