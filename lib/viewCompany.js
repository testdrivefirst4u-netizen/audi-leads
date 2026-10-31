// The company a super admin is working in for the "Company View" pages
// (Dashboard, Leads, Models, Chats, Reports, Agents, Campaigns…). It's picked
// once, in the top bar (components/CompanyPicker.js), and every one of those
// pages follows it through its CompanySwitcher — so moving between pages
// never asks for the company again. Remembered in localStorage across visits.

import { apiFetch } from "./apiFetch";

const KEY = "broaddcast:view-company";
export const VIEW_COMPANY_EVENT = "broaddcast:view-company-change";

export function getViewCompany() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return value && value.id ? value : null;
  } catch {
    return null;
  }
}

export function setViewCompany(company) {
  if (!company?._id) return;
  const value = { id: String(company._id), name: company.name || "", logoUrl: company.logoUrl || "" };
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // blocked storage: the pick still applies until the next full page load
  }
  window.dispatchEvent(new CustomEvent(VIEW_COMPANY_EVENT, { detail: value }));
}

// /api/companies is heavy (it counts every company's leads and agents), and
// both the top bar picker and the page's switcher need the list — so it's
// fetched once and shared, refreshed at most every few minutes.
const LIST_TTL_MS = 5 * 60 * 1000;
let listPromise = null;
let listFetchedAt = 0;

export function loadCompanies() {
  if (!listPromise || Date.now() - listFetchedAt > LIST_TTL_MS) {
    listFetchedAt = Date.now();
    listPromise = apiFetch("/api/companies")
      .then((res) => (res.ok ? res.json() : { companies: [] }))
      .then((data) => data.companies || [])
      .catch(() => {
        listPromise = null;
        return [];
      });
  }
  return listPromise;
}

// The company to show: the remembered pick if it still exists, otherwise the
// first one (which then becomes the remembered pick).
export function resolveViewCompany(companies) {
  if (!companies.length) return null;
  const remembered = getViewCompany();
  const match = companies.find((c) => String(c._id) === remembered?.id);
  if (match) return match;
  setViewCompany(companies[0]);
  return companies[0];
}
