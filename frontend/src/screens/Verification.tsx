import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { BackButton } from "../components/BackButton.tsx";
import type { Go } from "../components/Shell.tsx";
import { useLive } from "../live.ts";
import type { Verification } from "../verification.ts";
import { bySector, lastVerifiedLine, verificationSummary } from "../verification.ts";

/**
 * Verificación del censo: the active houses nobody has checked with their
 * family this year, under their sector, so the board can walk one sector at a
 * time. A tap opens the house's file, where "Datos revisados" marks it; the
 * way back returns here, and the house is gone from the list.
 */
export function VerificationScreen({ onOpen }: { onOpen: Go }) {
  const [list, setList] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = useLive();
  useEffect(() => {
    api<Verification>("GET", "/census/verification")
      .then(setList)
      .catch((err: Error) => setError(err.message));
  }, [live]);

  return (
    <main className="screen stack">
      <BackButton label="Censo" onClick={() => onOpen("/censo")} />
      <h1>Verificación del censo</h1>
      {!list && <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>}
      {list && (
        <>
          <p style={{ margin: 0 }}>
            <strong>{verificationSummary(list)}</strong>
          </p>
          {list.unverified.length > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Revise los datos con la familia, abra su vivienda y toque «Datos revisados».
            </p>
          )}
          {bySector(list.unverified).map((group) => (
            <section key={group.sectorName} className="stack" style={{ gap: 8 }}>
              <h2>
                {group.sectorName} ({group.houses.length})
              </h2>
              {group.houses.map((house) => (
                <button key={house.id} className="card household-card" onClick={() => onOpen(`/censo/vivienda/${house.id}`)}>
                  <strong>
                    {house.code} · {house.ownerName}
                  </strong>
                  {house.references && <div className="muted clip">{house.references}</div>}
                  <div className="muted">{lastVerifiedLine(house)}</div>
                </button>
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
