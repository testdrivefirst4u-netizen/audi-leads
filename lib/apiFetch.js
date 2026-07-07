// Thin wrapper around fetch: if the session cookie has expired mid-session,
// redirect to /login instead of silently rendering empty data from a 401.
export async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  return res;
}
