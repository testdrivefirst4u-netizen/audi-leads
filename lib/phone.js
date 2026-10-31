// One place for turning a lead's stored phone into something dialable.
//
// Leads arrive with phones in mixed shapes: Meta lead forms keep the country
// code ("919949475601"), sheets and hand-typed entries are usually 10 digits
// ("9949475601"), sometimes with a leading 0. All of these are the same
// customer, and links must always dial the full international number —
// "tel:+9949475601" would ring a wrong number.

export const DEFAULT_COUNTRY_CODE = "91";

export const digitsOnly = (phone) => String(phone || "").replace(/\D/g, "");

// Full international digits, no "+": 10-digit (and 0-prefixed 11-digit)
// Indian numbers get the 91 code; anything that already has one is left alone.
export function intlDigits(phone, countryCode = DEFAULT_COUNTRY_CODE) {
  const d = digitsOnly(phone);
  if (d.length === 10) return `${countryCode}${d}`;
  if (d.length === 11 && d.startsWith("0")) return `${countryCode}${d.slice(1)}`;
  return d;
}

// How the CRM stores an Indian phone on a lead it creates itself: plain 10
// digits (same as lib/messaging/chat.js's storedPhone).
export function storedPhone(phone) {
  const d = digitsOnly(phone);
  if (d.length === 12 && d.startsWith(DEFAULT_COUNTRY_CODE)) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
}

// Every shape the same number may have been stored in, for lookups.
export function phoneVariants(phone) {
  const local = storedPhone(phone);
  const set = new Set([digitsOnly(phone), local]);
  if (local.length === 10) {
    set.add(`${DEFAULT_COUNTRY_CODE}${local}`);
    set.add(`0${local}`);
  }
  return [...set].filter(Boolean);
}

export const telHref = (phone) => `tel:+${intlDigits(phone)}`;

export const waHref = (phone, text) => `https://wa.me/${intlDigits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
