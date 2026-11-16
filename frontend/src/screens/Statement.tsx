import { useEffect, useState } from "react";

import { api } from "../api.ts";
import type { HouseholdFile } from "../census.ts";
import { MonthField } from "../components/CalendarField.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import type { Statement, StatementDocument, StatementLine } from "../statement.ts";
import { statementFileName, statementLines, statementText, statementWhatsappLink } from "../statement.ts";
import { statementImage } from "../statementImage.ts";

/** A statement that was handed out, with its picture ready to send. */
interface Made {
  document: StatementDocument;
  statement: Statement;
  picture: Blob;
  pictureUrl: string;
}

/**
 * Estado de cuenta (App Plan, Module 5): what a house paid from a month the
 * treasurer chooses, and what it owes today. Looking at it changes nothing.
 * "Hacer para enviar" gives it a document number, puts it in Historial, and
 * draws it as a picture to share by WhatsApp, with the same words as a text
 * for the family's chat (owner, 15 November 2026).
 */
export function StatementScreen({ householdId, canHandOut, onOpen }: { householdId: string; canHandOut: boolean; onOpen: Go }) {
  const [from, setFrom] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The family's number, when this user may see it whole: the text goes to their chat.
  useEffect(() => {
    api<{ household: HouseholdFile }>("GET", `/census/households/${householdId}`)
      .then(({ household }) => setPhone(household.owner.phone))
      .catch(() => setPhone(null));
  }, [householdId]);

  useEffect(() => {
    let current = true;
    api<{ statement: Statement }>("GET", `/finance/households/${householdId}/statement${from ? `?from=${from}-01` : ""}`)
      .then((data) => {
        if (!current) return;
        setStatement(data.statement);
        setFrom((month) => month || data.statement.from.slice(0, 7));
        setError(null);
      })
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [householdId, from]);

  // The picture is let go of when another is made or the screen closes.
  useEffect(() => () => {
    if (made) URL.revokeObjectURL(made.pictureUrl);
  }, [made]);

  const leave = () => onOpen(`/censo/vivienda/${householdId}`);

  if (!statement) {
    return (
      <main className="screen stack">
        <button className="btn" style={{ justifySelf: "start" }} onClick={leave}>
          <Icon name="back" /> Vivienda
        </button>
        <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>
      </main>
    );
  }

  const handOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const handed = await api<{ statement: Statement; document: StatementDocument }>(
        "POST",
        `/finance/households/${householdId}/statement`,
        { from: statement.from },
      );
      const picture = await statementImage(statementLines(handed.statement, handed.document));
      setStatement(handed.statement);
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
    const file = new File([made.picture], statementFileName(made.statement, made.document), { type: "image/png" });
    if (!navigator.canShare?.({ files: [file] })) {
      setError("Este teléfono no deja compartir la imagen desde aquí. Toque «Guardar la imagen» y envíela desde WhatsApp.");
      return;
    }
    try {
      await navigator.share({ files: [file], title: `Estado de cuenta ${made.statement.household.code}` });
    } catch (err) {
      // Closing the share sheet without sending is not a problem to report.
      if ((err as Error).name !== "AbortError") {
        setError("No se pudo compartir. Toque «Guardar la imagen» y envíela desde WhatsApp.");
      }
    }
  };

  const whatsapp = made ? statementWhatsappLink(phone, statementText(made.statement, made.document)) : null;

  return (
    <main className="screen stack">
      <button className="btn" style={{ justifySelf: "start" }} onClick={leave}>
        <Icon name="back" /> Vivienda
      </button>
      <h1>Estado de cuenta</h1>
      {made ? (
        <>
          <p className="message ok">Estado de cuenta nº {made.document.number}, listo para enviar.</p>
          <button className="btn go block" onClick={() => void share()}>
            <Icon name="whatsapp" /> Compartir la imagen
          </button>
          {whatsapp ? (
            <a className="btn block" href={whatsapp} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" /> Enviar como texto
            </a>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No hay un número de WhatsApp de esta vivienda para enviarlo como texto: comparta la imagen o entréguelo en papel.
            </p>
          )}
          <a className="btn block" href={made.pictureUrl} download={statementFileName(made.statement, made.document)}>
            <Icon name="down" /> Guardar la imagen
          </a>
          {error && <p className="message error">{error}</p>}
          <img className="statement-picture" src={made.pictureUrl} alt={`Estado de cuenta nº ${made.document.number}`} />
          <button
            className="btn block"
            onClick={() => {
              setMade(null);
              window.scrollTo(0, 0);
            }}
          >
            <Icon name="edit" /> Hacer otro, desde otro mes
          </button>
        </>
      ) : (
        <>
          <label>
            Pagos desde
            <MonthField value={from} max={statement.today.slice(0, 7)} onChange={(month) => month && setFrom(month)} />
          </label>
          {error && <p className="message error">{error}</p>}
          {canHandOut && (
            <button className="btn go block" disabled={busy} onClick={() => void handOut()}>
              <Icon name="whatsapp" /> {busy ? "Haciendo…" : "Hacer para enviar"}
            </button>
          )}
          <StatementCard lines={statementLines(statement, null)} />
        </>
      )}
    </main>
  );
}

/** The statement on the screen, with the same lines the picture has. */
export function StatementCard({ lines }: { lines: readonly StatementLine[] }) {
  return (
    <div className="card statement">
      {lines.map((line, index) => (
        <div key={index} className={`statement-line ${line.kind}`}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 12 }}>
            <span>{line.text}</span>
            {line.amount && <span style={{ whiteSpace: "nowrap" }}>{line.amount}</span>}
          </div>
          {line.sub && <div className="muted statement-sub">{line.sub}</div>}
        </div>
      ))}
    </div>
  );
}
