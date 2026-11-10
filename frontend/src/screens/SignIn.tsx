import { useState } from "react";

import { api } from "../api.ts";
import { PasswordField } from "../components/PasswordField.tsx";
import { PhoneField } from "../components/PhoneField.tsx";
import { EMPTY_PHONE, phoneProblem, wholePhone } from "../phone.ts";

/**
 * "Entrar": the WhatsApp number and the password the administrator gave.
 * Typed once on a phone, which then stays signed in until "Salir", or for 90
 * days without use.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [phone, setPhone] = useState(EMPTY_PHONE);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A message about what was typed before is gone as soon as it is corrected.
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setError(null);
  };

  const submit = async () => {
    // Said in words, not by a grey button nobody knows why it will not press.
    const problem = phoneProblem(phone) ?? (password === "" ? "Escriba su contraseña." : null);
    setError(problem);
    if (problem || busy) return;

    setBusy(true);
    try {
      await api("POST", "/auth/login", { phone: wholePhone(phone), password });
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="screen centered stack">
      <h1>Junta de Agua Zoilabe</h1>
      <div className="field">
        Su número de WhatsApp
        <PhoneField value={phone} onChange={changed(setPhone)} />
      </div>
      <PasswordField label="Su contraseña" value={password} onChange={changed(setPassword)} onEnter={() => void submit()} />
      {error && <p className="message error">{error}</p>}
      <button className="btn go block" disabled={busy} onClick={() => void submit()}>
        Entrar
      </button>
      <p className="muted">¿Olvidó su contraseña? Pida al administrador una nueva.</p>
    </main>
  );
}
