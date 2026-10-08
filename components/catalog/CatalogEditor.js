import { useState } from "react";
import { useRouter } from "next/router";
import { apiFetch } from "../../lib/apiFetch";
import { useToast } from "../ToastProvider";
import { BODY_TYPES, FUEL_TYPES, TRANSMISSIONS, FILE_KINDS, formatBytes, formatPriceShort } from "../../lib/catalog";
import { uploadCatalogFile } from "./uploadCatalogFile";

const EMPTY_VARIANT = { name: "", exShowroomPrice: "", onRoadPrice: "", fuel: "", transmission: "", engine: "", power: "", torque: "", mileage: "", seats: "", features: "" };

// The form state keeps lists as text (features/aliases one per line) and
// prices as typed; the API normalises both (lib/catalogInput.js).
function toForm(model) {
  return {
    name: model?.name || "",
    tagline: model?.tagline || "",
    bodyType: model?.bodyType || "",
    fuel: model?.fuel || "",
    description: model?.description || "",
    imageUrl: model?.imageUrl || "",
    imageFileId: model?.imageFileId || "",
    aliases: (model?.aliases || []).join("\n"),
    onSale: model?.onSale ?? true,
    sortOrder: model?.sortOrder ?? 0,
    variants: (model?.variants || []).map((v) => ({ ...EMPTY_VARIANT, ...v, exShowroomPrice: v.exShowroomPrice ?? "", onRoadPrice: v.onRoadPrice ?? "", features: (v.features || []).join("\n") })),
    colours: (model?.colours || []).map((c) => ({ ...c })),
    files: (model?.files || []).map((f) => ({ ...f })),
  };
}

function Field({ label, hint, children }) {
  return (
    <div className="field mb-0">
      <label>
        {label}
        {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function SectionCard({ title, description, action, children }) {
  return (
    <section className="panel mb-5">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          {description && <p className="hint m-0 mt-1">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// A file picker that uploads immediately and reports the result.
function UploadButton({ label, kind, onUploaded, disabled }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      onUploaded(await uploadCatalogFile(file, { kind }));
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={`btn-sm inline-flex cursor-pointer items-center gap-1.5 ${busy || disabled ? "pointer-events-none opacity-60" : ""}`}>
      <input type="file" className="sr-only" accept={kind === "image" ? "image/png,image/jpeg,image/webp" : "application/pdf,image/png,image/jpeg,image/webp"} onChange={onPick} />
      {busy ? "Uploading..." : label}
    </label>
  );
}

export default function CatalogEditor({ model }) {
  const router = useRouter();
  const toast = useToast();
  const isNew = !model?._id;
  const [form, setForm] = useState(() => toForm(model));
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setItem = (list, i, patch) => setForm((f) => ({ ...f, [list]: f[list].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const removeItem = (list, i) => setForm((f) => ({ ...f, [list]: f[list].filter((_, j) => j !== i) }));
  const addItem = (list, item) => setForm((f) => ({ ...f, [list]: [...f[list], item] }));
  const moveItem = (list, i, dir) =>
    setForm((f) => {
      const next = [...f[list]];
      const j = i + dir;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, [list]: next };
    });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch(isNew ? "/api/catalog" : `/api/catalog/${model._id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the model");
      toast(isNew ? `${data.model.name} added` : `${data.model.name} saved`);
      router.push(`/catalog/${data.model._id}`);
    } catch (err) {
      toast(err.message, { type: "err" });
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSaving(true);
    const res = await apiFetch(`/api/catalog/${model._id}`, { method: "DELETE" });
    if (res.ok) {
      toast(`${model.name} deleted`);
      router.push("/catalog");
    } else {
      toast("Couldn't delete the model", { type: "err" });
      setSaving(false);
      setDeleteArmed(false);
    }
  }

  return (
    <form onSubmit={save}>
      <datalist id="body-types">
        {BODY_TYPES.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="fuel-types">
        {FUEL_TYPES.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="transmissions">
        {TRANSMISSIONS.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      <SectionCard title="Model" description="What agents see first on the Models page.">
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-2">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-border bg-bg">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt={form.name || "Model photo"} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[13px] text-muted">No photo yet</span>
              )}
            </div>
            <div className="flex gap-2">
              <UploadButton label={form.imageUrl ? "Replace photo" : "Upload photo"} kind="image" onUploaded={(f) => setForm((x) => ({ ...x, imageUrl: f.url, imageFileId: f.fileId }))} />
              {form.imageUrl && (
                <button type="button" className="btn-sm" onClick={() => setForm((x) => ({ ...x, imageUrl: "", imageFileId: "" }))}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Model name">
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Q5" required maxLength={80} />
            </Field>
            <Field label="Tagline" hint="(optional)">
              <input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="The everyday luxury SUV" />
            </Field>
            <Field label="Body type">
              <input list="body-types" value={form.bodyType} onChange={(e) => set("bodyType", e.target.value)} placeholder="SUV" />
            </Field>
            <Field label="Fuel">
              <input list="fuel-types" value={form.fuel} onChange={(e) => set("fuel", e.target.value)} placeholder="Petrol" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="About this car" hint="(selling points, who it suits)">
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink"
                />
              </Field>
            </div>
            <Field label="Other names leads use" hint="(one per line, e.g. q5 jun)">
              <textarea
                rows={3}
                value={form.aliases}
                onChange={(e) => set("aliases", e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink"
              />
            </Field>
            <div className="flex flex-col gap-3">
              <Field label="Display order" hint="(lower shows first)">
                <input type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.onSale} onChange={(e) => set("onSale", e.target.checked)} />
                On sale <span className="text-muted">— untick to hide it from agents</span>
              </label>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={`Variants (${form.variants.length})`}
        description="Prices in rupees. Agents see these side by side to compare."
        action={
          <button type="button" className="btn-sm" onClick={() => addItem("variants", { ...EMPTY_VARIANT })}>
            + Add variant
          </button>
        }
      >
        {form.variants.length === 0 && <p className="hint m-0">No variants yet. Add one for each trim you sell.</p>}
        <div className="flex flex-col gap-4">
          {form.variants.map((v, i) => (
            <div key={v._id || i} className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-muted">Variant {i + 1}</span>
                <div className="flex gap-1.5">
                  <button type="button" className="btn-sm" onClick={() => moveItem("variants", i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="btn-sm" onClick={() => moveItem("variants", i, 1)} disabled={i === form.variants.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="btn-sm text-danger" onClick={() => removeItem("variants", i)}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <Field label="Variant name">
                    <input value={v.name} onChange={(e) => setItem("variants", i, { name: e.target.value })} placeholder="Technology 45 TFSI" required />
                  </Field>
                </div>
                <Field label="Ex-showroom price" hint={v.exShowroomPrice ? `(${formatPriceShort(String(v.exShowroomPrice).replace(/[^\d.]/g, ""))})` : ""}>
                  <input inputMode="numeric" value={v.exShowroomPrice} onChange={(e) => setItem("variants", i, { exShowroomPrice: e.target.value })} placeholder="6599000" />
                </Field>
                <Field label="On-road price" hint={v.onRoadPrice ? `(${formatPriceShort(String(v.onRoadPrice).replace(/[^\d.]/g, ""))})` : ""}>
                  <input inputMode="numeric" value={v.onRoadPrice} onChange={(e) => setItem("variants", i, { onRoadPrice: e.target.value })} placeholder="7612000" />
                </Field>
                <Field label="Fuel" hint="(if different)">
                  <input list="fuel-types" value={v.fuel} onChange={(e) => setItem("variants", i, { fuel: e.target.value })} placeholder={form.fuel || "Petrol"} />
                </Field>
                <Field label="Transmission">
                  <input list="transmissions" value={v.transmission} onChange={(e) => setItem("variants", i, { transmission: e.target.value })} placeholder="Automatic" />
                </Field>
                <Field label="Engine">
                  <input value={v.engine} onChange={(e) => setItem("variants", i, { engine: e.target.value })} placeholder="1984 cc" />
                </Field>
                <Field label="Power">
                  <input value={v.power} onChange={(e) => setItem("variants", i, { power: e.target.value })} placeholder="265 hp" />
                </Field>
                <Field label="Torque">
                  <input value={v.torque} onChange={(e) => setItem("variants", i, { torque: e.target.value })} placeholder="370 Nm" />
                </Field>
                <Field label="Mileage">
                  <input value={v.mileage} onChange={(e) => setItem("variants", i, { mileage: e.target.value })} placeholder="13.47 km/l" />
                </Field>
                <Field label="Seats">
                  <input value={v.seats} onChange={(e) => setItem("variants", i, { seats: e.target.value })} placeholder="5" />
                </Field>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Field label="Key features" hint="(one per line)">
                    <textarea
                      rows={3}
                      value={v.features}
                      onChange={(e) => setItem("variants", i, { features: e.target.value })}
                      placeholder={"Panoramic sunroof\nMatrix LED headlights\nBang & Olufsen 3D sound"}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink"
                    />
                  </Field>
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={`Colours (${form.colours.length})`}
        action={
          <button type="button" className="btn-sm" onClick={() => addItem("colours", { name: "", hex: "#1c2130", imageUrl: "", imageFileId: "" })}>
            + Add colour
          </button>
        }
      >
        {form.colours.length === 0 && <p className="hint m-0">No colours yet.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {form.colours.map((c, i) => (
            <div key={c._id || i} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <input type="color" aria-label={`${c.name || "Colour"} swatch`} value={c.hex || "#1c2130"} onChange={(e) => setItem("colours", i, { hex: e.target.value })} className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-border p-0.5" />
              {c.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" />
              )}
              <input value={c.name} onChange={(e) => setItem("colours", i, { name: e.target.value })} placeholder="Navarra Blue" required aria-label="Colour name" className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink" />
              <UploadButton label={c.imageUrl ? "Photo ✓" : "Photo"} kind="image" onUploaded={(f) => setItem("colours", i, { imageUrl: f.url, imageFileId: f.fileId })} />
              <button type="button" className="btn-sm text-danger" onClick={() => removeItem("colours", i)} aria-label={`Remove ${c.name || "colour"}`}>
                ×
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={`Brochures & files (${form.files.length})`}
        description="PDF up to 25 MB, or an image. Agents can open, download and share these."
        action={
          <UploadButton
            label="+ Upload file"
            kind="document"
            onUploaded={(f) =>
              addItem("files", {
                kind: form.files.some((x) => x.kind === "brochure") ? "price_list" : "brochure",
                title: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
                url: f.url,
                fileId: f.fileId,
                size: f.size,
                mimeType: f.mimeType,
                uploadedAt: new Date().toISOString(),
              })
            }
          />
        }
      >
        {form.files.length === 0 && <p className="hint m-0">No files yet. Upload the brochure first — it's what agents send most.</p>}
        <div className="flex flex-col gap-2.5">
          {form.files.map((f, i) => (
            <div key={f._id || f.fileId || i} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
              <span className="pill bg-bg text-muted">{f.mimeType === "application/pdf" ? "PDF" : "Image"}</span>
              <select value={f.kind} onChange={(e) => setItem("files", i, { kind: e.target.value })} aria-label="File type" className="rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-ink">
                {FILE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input value={f.title} onChange={(e) => setItem("files", i, { title: e.target.value })} aria-label="File title" className="min-w-[180px] flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink" />
              <span className="text-[12px] text-muted">{formatBytes(f.size)}</span>
              <a href={f.url} target="_blank" rel="noreferrer" className="btn-sm no-underline">
                Open
              </a>
              <button type="button" className="btn-sm text-danger" onClick={() => removeItem("files", i)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2.5 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : isNew ? "Add model" : "Save changes"}
        </button>
        <button type="button" className="btn-sm" onClick={() => router.push(isNew ? "/catalog" : `/catalog/${model._id}`)} disabled={saving}>
          Cancel
        </button>
        {!isNew && (
          <button
            type="button"
            className="btn-sm ml-auto"
            style={deleteArmed ? { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" } : undefined}
            onClick={remove}
            disabled={saving}
          >
            {deleteArmed ? "Confirm delete?" : "Delete model"}
          </button>
        )}
      </div>
    </form>
  );
}
