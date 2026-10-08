import { apiFetch } from "../../lib/apiFetch";
import { DOCUMENT_TYPES, IMAGE_TYPES, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, formatBytes } from "../../lib/catalog";

// Uploads a catalog photo or brochure straight from the browser to ImageKit
// (see pages/api/catalog/upload-auth.js for why it doesn't go through our
// server). Resolves to { url, fileId, size, mimeType, name }; rejects with a
// readable message.
export async function uploadCatalogFile(file, { kind = "document" } = {}) {
  const types = kind === "image" ? IMAGE_TYPES : DOCUMENT_TYPES;
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (!types.includes(file.type)) {
    throw new Error(kind === "image" ? "Use a PNG, JPG or WEBP image" : "Use a PDF, or a PNG/JPG/WEBP image");
  }
  if (file.size > max) throw new Error(`${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(max)}`);

  const authRes = await apiFetch("/api/catalog/upload-auth");
  const auth = await authRes.json().catch(() => ({}));
  if (!authRes.ok) throw new Error(auth.error || "Couldn't start the upload");

  const form = new FormData();
  form.append("file", file);
  form.append("fileName", file.name.replace(/[^\w.\-]+/g, "_"));
  form.append("publicKey", auth.publicKey);
  form.append("signature", auth.signature);
  form.append("expire", String(auth.expire));
  form.append("token", auth.token);
  form.append("folder", auth.folder);
  form.append("useUniqueFileName", "true");

  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Upload failed — please try again");
  return { url: data.url, fileId: data.fileId, size: data.size || file.size, mimeType: file.type, name: file.name };
}
