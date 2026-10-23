import { Icon } from "../icons.tsx";

/** A phone the app does not know: the only way in is the invitation link. */
export function UnregisteredScreen() {
  return (
    <main className="screen centered stack">
      <h1>Junta de Agua Zoilabe</h1>
      <p>
        <Icon name="phone" /> Este teléfono no está registrado.
      </p>
      <p>
        Abra el enlace de invitación que le enviaron por WhatsApp, en este mismo teléfono. Si no lo tiene o ya
        venció, pídale uno nuevo al administrador.
      </p>
    </main>
  );
}
