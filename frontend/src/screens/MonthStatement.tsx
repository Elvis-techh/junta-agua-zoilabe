import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { api } from "../api.ts";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { monthStatementFileName, monthStatementLines, monthStatementText } from "../monthStatement.ts";
import type { MonthSummary } from "../monthSummary.ts";
import type { StatementDocument } from "../statement.ts";
import { statementImage } from "../statementImage.ts";
import { StatementCard } from "./Statement.tsx";

/** A month's statement that was handed out, with its picture ready to send. */
interface Made {
  document: StatementDocument;
  summary: MonthSummary;
  picture: Blob;
  pictureUrl: string;
}

/**
 * Estado financiero del mes (owner, 23 November 2026): the month's summary as
 * a document with a number, to send by WhatsApp or save to print. Looking at
 * it changes nothing; "Hacer para enviar" gives it its number, puts it in
 * Historial and draws it as a picture, as a house's Estado de cuenta does.
 * The text goes to a chat the sender chooses: a month's statement is for the
 * board and the fiscal, not for one family.
 */
export function MonthStatementPart({ summary, canHandOut, back, onOpen }: { summary: MonthSummary; canHandOut: boolean; back: ReactNode; onOpen: Go }) {
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The picture is let go of when another is made or the screen closes.
  useEffect(() => () => {
    if (made) URL.revokeObjectURL(made.pictureUrl);
  }, [made]);

  const handOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const handed = await api<{ summary: MonthSummary; document: StatementDocument }>("POST", `/finance/summary/${summary.month}/statement`);
      const picture = await statementImage(monthStatementLines(handed.summary, handed.document));
      setMade({ ...handed, picture, pictureUrl: URL.createObjectURL(picture) });
      window.scrollTo(0, 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!made) return;
    setError(null);
    const file = new File([made.picture], monthStatementFileName(made.summary, made.document), { type: "image/png" });
    if (!navigator.canShare?.({ files: [file] })) {
      setError("Este teléfono no deja compartir la imagen desde aquí. Toque «Guardar la imagen» y envíela desde WhatsApp.");
      return;
    }
    try {
      await navigator.share({ files: [file], title: `Estado financiero nº ${made.document.number}` });
    } catch (err) {
      // Closing the share sheet without sending is not a problem to report.
      if ((err as Error).name !== "AbortError") {
        setError("No se pudo compartir. Toque «Guardar la imagen» y envíela desde WhatsApp.");
      }
    }
  };

  if (made) {
    // No number: WhatsApp asks which chat to send it to.
    const whatsapp = `https://wa.me/?text=${encodeURIComponent(monthStatementText(made.summary, made.document))}`;
    return (
      <main className="screen stack">
        {back}
        <h1>Estado financiero</h1>
        <p className="message ok">Estado financiero nº {made.document.number}, listo para enviar.</p>
        <button className="btn go block" onClick={() => void share()}>
          <Icon name="whatsapp" /> Compartir la imagen
        </button>
        <a className="btn block" href={whatsapp} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" /> Enviar como texto
        </a>
        <a className="btn block" href={made.pictureUrl} download={monthStatementFileName(made.summary, made.document)}>
          <Icon name="down" /> Guardar la imagen
        </a>
        {error && <p className="message error">{error}</p>}
        <img className="statement-picture" src={made.pictureUrl} alt={`Estado financiero nº ${made.document.number}`} />
        <button className="btn block" onClick={() => onOpen(`/finanzas/resumen/${summary.month}`)}>
          <Icon name="chart" /> Volver al resumen
        </button>
      </main>
    );
  }

  return (
    <main className="screen stack">
      {back}
      <h1>Estado financiero</h1>
      {error && <p className="message error">{error}</p>}
      {canHandOut && (
        <button className="btn go block" disabled={busy} onClick={() => void handOut()}>
          <Icon name="whatsapp" /> {busy ? "Haciendo…" : "Hacer para enviar"}
        </button>
      )}
      <StatementCard lines={monthStatementLines(summary, null)} />
    </main>
  );
}
