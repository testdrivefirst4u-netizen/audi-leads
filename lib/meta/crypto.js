const crypto = require("crypto");

// Page access tokens are long-lived credentials that can read every lead a
// page ever receives — they're stored encrypted at rest (AES-256-GCM) with
// a key derived from AUTH_SECRET, the one secret this app already requires
// everywhere. Rotating AUTH_SECRET therefore also invalidates stored page
// tokens (the Meta page will report them as "needs re-connecting").
//
// This is defence in depth against a leaked DB dump, not a substitute for
// keeping AUTH_SECRET itself out of the repo — which .gitignore already
// enforces for .env.

const ALGO = "aes-256-gcm";
const VERSION = "v1";

function deriveKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot encrypt Meta credentials.");
  return crypto.scryptSync(secret, "broaddcast-crm:meta-token", 32);
}

function encryptSecret(plain) {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

function decryptSecret(stored) {
  if (!stored) return "";
  const [version, ivB64, tagB64, dataB64] = String(stored).split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) throw new Error("Unrecognised encrypted token format");
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// What the admin UI shows instead of the token — enough to recognise which
// token was pasted, never enough to use it.
function tokenPreview(token) {
  if (!token) return "";
  const t = String(token);
  if (t.length <= 12) return "•".repeat(t.length);
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

module.exports = { encryptSecret, decryptSecret, tokenPreview };
