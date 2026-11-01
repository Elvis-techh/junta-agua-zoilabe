import { Icon } from "../icons.tsx";
import { testCopyLabel } from "../testCopy.ts";

const label = testCopyLabel(import.meta.env.VITE_TEST_COPY_BRANCH, import.meta.env.VITE_TEST_COPY_COMMIT);

/**
 * On the test copy only, above every screen (sign-in included): so nobody
 * types a real family into it, and so whoever is testing can see which
 * change they have in their hand.
 */
export function TestCopyBanner() {
  if (!label) {
    return null;
  }
  return (
    <div className="test-copy-banner" role="note">
      <Icon name="alert" size={22} />
      <span>
        <strong>Copia de prueba.</strong> Use solo datos inventados.
        <small>Versión {label}</small>
      </span>
    </div>
  );
}
