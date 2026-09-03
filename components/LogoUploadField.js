import { useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Shared by every place that lets someone upload an image to ImageKit and
// just wants the resulting URL back — the Companies panel's logo field and
// per-company Logo row, and the super admin's own avatar on the Account
// page. Picking a file uploads it immediately; onChange fires with the URL.
export default function LogoUploadField({ value, onChange, folder, shape = "square" }) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const res = await apiFetch("/api/upload/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64, filename: file.name, mimeType: file.type, folder }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onChange(data.url);
      toast("Logo uploaded");
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <img
          src={value}
          alt="Logo preview"
          style={{
            height: 36,
            width: 36,
            objectFit: "contain",
            borderRadius: shape === "circle" ? "50%" : 6,
            border: "1px solid var(--border)",
          }}
        />
      ) : null}
      <div className="flex-1">
        <input type="file" accept={LOGO_ACCEPT} onChange={handleFile} disabled={uploading} />
        {uploading && <div className="hint mt-1">Uploading...</div>}
      </div>
      {value ? (
        <button className="btn-sm" type="button" onClick={() => onChange("")} disabled={uploading}>
          Remove
        </button>
      ) : null}
    </div>
  );
}
