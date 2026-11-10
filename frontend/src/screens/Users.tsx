import { useCallback, useEffect, useState } from "react";

import type { Me, StaffUser } from "../api.ts";
import { api } from "../api.ts";
import { Dialog } from "../components/Dialog.tsx";
import { PasswordField } from "../components/PasswordField.tsx";
import { PhoneField } from "../components/PhoneField.tsx";
import { Icon } from "../icons.tsx";
import { passwordProblem, suggestPassword } from "../password.ts";
import { EMPTY_PHONE, formatPhone, phoneProblem, wholePhone } from "../phone.ts";
import { ROLES, roleName } from "../roles.ts";
import { formatDateTime } from "../time.ts";
import { isTouchScreen } from "../viewport.ts";

/** Status as word + icon + color together, never color alone. */
function StatusBadge({ user }: { user: StaffUser }) {
  switch (user.status) {
    case "active":
    case "invited":
      // An account from before passwords cannot sign in until it gets one.
      return user.hasPassword ? (
        <span className="status ok"><Icon name="check" size={18} /> Activa</span>
      ) : (
        <span className="status warn"><Icon name="lock" size={18} /> Sin contraseña</span>
      );
    case "suspended":
      return <span className="status danger"><Icon name="x" size={18} /> Suspendida</span>;
    case "deactivated":
      return <span className="status danger"><Icon name="x" size={18} /> Desactivada</span>;
  }
}

export function UsersScreen({ me }: { me: Me }) {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<StaffUser | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: StaffUser[] }>("GET", "/users");
      setUsers(data.users);
      setSelected((current) => (current ? data.users.find((u) => u.id === current.id) ?? null : null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="screen stack">
      <h1>Usuarios</h1>
      <button className="btn primary block" onClick={() => setCreating(true)}>
        <Icon name="plus" /> Nueva cuenta
      </button>
      {error && <p className="message error">{error}</p>}
      {!users && !error && <p className="muted">Cargando…</p>}

      <div className="list">
        {users?.map((user) => (
          <button
            key={user.id}
            className="card"
            style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}
            onClick={() => setSelected(user)}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>{user.name}</strong>
              <StatusBadge user={user} />
            </div>
            <div className="muted">
              {user.roleName} · {formatPhone(user.phone)}
            </div>
            <div className="muted">
              {user.lastLoginAt ? `Último ingreso: ${formatDateTime(user.lastLoginAt)}` : "Todavía no ha entrado"}
            </div>
          </button>
        ))}
      </div>

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(id, message) => {
            setCreating(false);
            // Open the new account straight away, with the number and password to give the person.
            setCreated(message);
            void api<{ users: StaffUser[] }>("GET", "/users").then((data) => {
              setUsers(data.users);
              setSelected(data.users.find((u) => u.id === id) ?? null);
            });
          }}
        />
      )}

      {selected && (
        <UserActions
          user={selected}
          isSelf={selected.id === me.id}
          firstMessage={created}
          onClose={() => {
            setSelected(null);
            setCreated(null);
          }}
          onChanged={load}
        />
      )}
    </main>
  );
}

/** What to tell the person, so they can sign in. */
function signInWords(phone: string, password: string): string {
  return `Para entrar: el número ${formatPhone(phone)} y la contraseña ${password}`;
}

/** Nueva cuenta: name, WhatsApp, role and password, then "¿Está correcto?". */
function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, message: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(EMPTY_PHONE);
  const [roleCode, setRoleCode] = useState("");
  // Offered ready to use; the administrator can type another.
  const [password, setPassword] = useState(suggestPassword);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const review = () => {
    const problem = passwordProblem(password);
    setError(problem);
    if (!problem) setReviewing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const whole = wholePhone(phone);
      const { user } = await api<{ user: { id: string } }>("POST", "/users", { name, phone: whole, roleCode, password });
      onCreated(user.id, `Cuenta creada. ${signInWords(whole, password)}.`);
    } catch (err) {
      setError((err as Error).message);
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Nueva cuenta" onClose={onClose}>
      {!reviewing ? (
        <>
          <label>
            Nombre completo
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!isTouchScreen()} autoCapitalize="words" />
          </label>
          <div className="field">
            Número de WhatsApp
            <PhoneField value={phone} onChange={setPhone} />
          </div>
          <label>
            Cargo
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              <option value="">Elija un cargo</option>
              {ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          {/* Offered ready to use. No line under it: "Siguiente" must still fit on a phone's screen. */}
          <PasswordField label="Contraseña para entrar" value={password} onChange={setPassword} isNew />
          {error && <p className="message error">{error}</p>}
          <button
            className="btn go block"
            disabled={name.trim().length < 3 || phoneProblem(phone) !== null || !roleCode}
            onClick={review}
          >
            Siguiente
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: "1.2rem" }}>¿Está correcto?</p>
          <div className="card">
            <strong>{name.trim()}</strong>
            <div>WhatsApp: {formatPhone(wholePhone(phone))}</div>
            <div>Cargo: {roleName(roleCode)}</div>
            <div>Contraseña: {password}</div>
          </div>
          <p>Désela a la persona: con su número y esta contraseña entra a la app.</p>
          <button className="btn go block" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> Sí, crear la cuenta
          </button>
          <button className="btn block" onClick={() => setReviewing(false)}>
            <Icon name="back" /> Corregir
          </button>
        </>
      )}
    </Dialog>
  );
}

function UserActions({
  user,
  isSelf,
  firstMessage,
  onClose,
  onChanged,
}: {
  user: StaffUser;
  isSelf: boolean;
  firstMessage: string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    firstMessage ? { kind: "ok", text: firstMessage } : null,
  );
  const [newRole, setNewRole] = useState(user.roleCode);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: done });
      await onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  };

  const savePassword = async (password: string) => {
    const problem = passwordProblem(password);
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    await run(
      () => api("POST", `/users/${user.id}/password`, { password }),
      isSelf
        ? `Su contraseña nueva es ${password}.`
        : `Contraseña cambiada. ${signInWords(user.phone, password)}. Si tenía la app abierta en otro teléfono, ahí tendrá que entrar otra vez.`,
    );
    setNewPassword(null);
  };

  return (
    <Dialog title={user.name} onClose={onClose}>
      <div className="row" style={{ alignItems: "center" }}>
        <StatusBadge user={user} />
        <span className="muted">{user.roleName}</span>
      </div>

      {message && <p className={`message ${message.kind}`}>{message.text}</p>}

      {user.status !== "deactivated" &&
        (newPassword === null ? (
          <button className="btn primary block" onClick={() => setNewPassword(suggestPassword())}>
            <Icon name="lock" /> {user.hasPassword ? "Cambiar contraseña" : "Poner contraseña"}
          </button>
        ) : (
          <div className="card stack">
            <PasswordField
              label="Contraseña nueva"
              value={newPassword}
              onChange={setNewPassword}
              onEnter={() => void savePassword(newPassword)}
              isNew
            />
            <p className="muted">
              {isSelf ? "Puede dejar esta o escribir otra." : "Puede dejar esta o escribir otra. Désela a la persona."}
            </p>
            <button className="btn go block" onClick={() => void savePassword(newPassword)}>
              <Icon name="check" /> Guardar contraseña
            </button>
            <button className="btn block" onClick={() => setNewPassword(null)}>
              <Icon name="back" /> Volver
            </button>
          </div>
        ))}

      {!isSelf && user.status !== "deactivated" && (
        <>
          <h2>Cargo</h2>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {ROLES.map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
          <button
            className="btn block"
            disabled={newRole === user.roleCode}
            onClick={() =>
              void run(
                () => api("PATCH", `/users/${user.id}/role`, { roleCode: newRole }),
                `Cargo cambiado a ${roleName(newRole)}.`,
              )
            }
          >
            <Icon name="check" /> Cambiar cargo a {roleName(newRole)}
          </button>
        </>
      )}

      {!isSelf && (
        <>
          <h2>Cuenta</h2>
          {(user.status === "active" || user.status === "invited") && (
            <button
              className="btn danger block"
              onClick={() => void run(() => api("POST", `/users/${user.id}/suspend`, {}), "Cuenta suspendida. Ya no puede entrar.")}
            >
              Suspender
            </button>
          )}
          {user.status === "suspended" && (
            <button
              className="btn block"
              onClick={() => void run(() => api("POST", `/users/${user.id}/reactivate`), "Cuenta reactivada. Entra con la misma contraseña.")}
            >
              Reactivar
            </button>
          )}
          {user.status !== "deactivated" && (
            <button
              className="btn danger block"
              onClick={() =>
                window.confirm(`¿Desactivar la cuenta de ${user.name}? Ya no podrá entrar.`) &&
                void run(() => api("POST", `/users/${user.id}/deactivate`, {}), "Cuenta desactivada.")
              }
            >
              Desactivar
            </button>
          )}
        </>
      )}
    </Dialog>
  );
}
