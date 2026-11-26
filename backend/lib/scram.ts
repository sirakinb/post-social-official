// Turns a password into the form Postgres stores (SCRAM-SHA-256), so setting a login's
// password never sends the password itself to the database, where a statement can end up in
// a log. Same result as psql's \password. Node only.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 4096;

export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  // Passwords we generate are plain letters and digits, so no Unicode preparation is needed.
  if (!/^[\x21-\x7e]{16,}$/.test(password)) throw new Error("A database password must be at least 16 printable ASCII characters with no spaces.");
  const salted = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

// The statement that sets a login's password. Both parts are checked, so nothing typed by a
// person or read from a setting can change the statement's meaning.
export function setPasswordStatement(role: string, password: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Not a role name.");
  const verifier = scramVerifier(password);
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) throw new Error("Couldn't prepare the password.");
  return `ALTER ROLE ${role} PASSWORD '${verifier}'`;
}
