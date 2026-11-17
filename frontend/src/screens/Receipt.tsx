import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { Dialog } from "../components/Dialog.tsx";
import { Icon } from "../icons.tsx";
import type { Receipt } from "../receipt.ts";
import { receiptFileName, receiptLines, receiptText } from "../receipt.ts";
import type { StatementDocument } from "../statement.ts";
import { statementImage } from "../statementImage.ts";
import { statementWhatsappLink } from "../statement.ts";
import { StatementCard } from "./Statement.tsx";

/** A receipt that was handed out, with its picture ready to send. */
interface Made {
  document: StatementDocument;
  receipt: Receipt;
  picture: Blob;
  pictureUrl: string;
}

/**
 * Recibo digital (App Plan, Module 2): one money-in entry as a receipt, made
 * only when someone asks. It is drawn as a picture to share by WhatsApp, with
 * the same words as a text for the family's chat, like a statement. The paper
 * receipt the payer was handed stays; this does not replace it.
 *
 * `phone` is the family's number, when the caller has it, so "Enviar como
 * texto" can open their chat; without it only the picture is shared.
 */
export function ReceiptDialog({
  transactionId,
  phone,
  canHandOut,
  onClose,
}: {
  transactionId: string;
  phone?: string | null;
  canHandOut: boolean;
  onClose: () => void;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ receipt: Receipt }>("GET", `/finance/receipts/${transactionId}`)
      .then((data) => setReceipt(data.receipt))
      .catch((err: Error) => setError(err.message));
  }, [transactionId]);

  // The picture is let go of when the dialog closes.
  useEffect(() => () => {
    if (made) URL.revokeObjectURL(made.pictureUrl);
  }, [made]);

  const handOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const handed = await api<{ receipt: Receipt; document: StatementDocument }>("POST", `/finance/receipts/${transactionId}`);
      const picture = await statementImage(receiptLines(handed.receipt, handed.document));
      setReceipt(handed.receipt);
      setMade({ ...handed, picture, pictureUrl: URL.createObjectURL(picture) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!made) return;
    setError(null);
    const file = new File([made.picture], receiptFileName(made.receipt, made.document), { type: "image/png" });
    if (!navigator.canShare?.({ files: [file] })) {
      setError("Este teléfono no deja compartir la imagen desde aquí. Toque «Guardar la imagen» y envíela desde WhatsApp.");
      return;
    }
    try {
      await navigator.share({ files: [file], title: `Recibo nº ${made.document.number}` });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("No se pudo compartir. Toque «Guardar la imagen» y envíela desde WhatsApp.");
      }
    }
  };

  const whatsapp = made ? statementWhatsappLink(phone ?? null, receiptText(made.receipt, made.document)) : null;

  return (
    <Dialog title={made ? `Recibo nº ${made.document.number}` : "Recibo"} onClose={onClose}>
      {!receipt ? (
        <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>
      ) : made ? (
        <>
          <button className="btn go block" onClick={() => void share()}>
            <Icon name="whatsapp" /> Compartir la imagen
          </button>
          {whatsapp ? (
            <a className="btn block" href={whatsapp} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" /> Enviar como texto
            </a>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No hay un número de WhatsApp para enviarlo como texto: comparta la imagen o entréguelo en papel.
            </p>
          )}
          <a className="btn block" href={made.pictureUrl} download={receiptFileName(made.receipt, made.document)}>
            <Icon name="down" /> Guardar la imagen
          </a>
          {error && <p className="message error">{error}</p>}
          <img className="statement-picture" src={made.pictureUrl} alt={`Recibo nº ${made.document.number}`} />
        </>
      ) : (
        <>
          <StatementCard lines={receiptLines(receipt, null)} />
          {error && <p className="message error">{error}</p>}
          {canHandOut ? (
            <button className="btn go block" disabled={busy} onClick={() => void handOut()}>
              <Icon name="whatsapp" /> {busy ? "Haciendo…" : "Hacer y compartir"}
            </button>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Para hacer el recibo y enviarlo hace falta el permiso «Imprimir y exportar finanzas».
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
