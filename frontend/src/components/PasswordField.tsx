import { useState } from "react";

/**
 * A password with "Ver" beside it, so someone unsure of what they typed can
 * look instead of guessing. A new password (`isNew`) starts visible: the
 * administrator reads it out to the person it is for.
 */
export function PasswordField({
  label,
  value,
  onChange,
  onEnter,
  isNew = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  isNew?: boolean;
}) {
  const [shown, setShown] = useState(isNew);
  return (
    <div className="field">
      {label}
      <div className="password-field">
        <input
          type={shown ? "text" : "password"}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) onEnter();
          }}
          autoComplete={isNew ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" className="btn" aria-pressed={shown} onClick={() => setShown(!shown)}>
          {shown ? "Ocultar" : "Ver"}
        </button>
      </div>
    </div>
  );
}
