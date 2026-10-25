import { useState } from "react";

import { api } from "../api.ts";
import { Dialog } from "./Dialog.tsx";
import { PinField } from "./PinField.tsx";

/**
 * "Escriba su PIN otra vez": asked before a sensitive action (changing a role
 * now; closing a month and correcting an entry in later phases).
 */
export function ConfirmPin({ onConfirmed, onClose }: { onConfirmed: () => void; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/confirm-pin", { pin });
      onConfirmed();
    } catch (err) {
      setError((err as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Confirme con su PIN" onClose={onClose}>
      <PinField label="Su PIN de 6 números" value={pin} onChange={setPin} autoFocus />
      {error && <p className="message error">{error}</p>}
      <button className="btn go block" disabled={pin.length !== 6 || busy} onClick={() => void submit()}>
        Confirmar
      </button>
    </Dialog>
  );
}
