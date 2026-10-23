/** Read one required variable for the database scripts, with a clear message when it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy backend/.env.example to backend/.env and fill it in.`);
  }
  return value;
}
