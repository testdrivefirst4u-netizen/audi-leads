import { getSessionFromCookieHeader } from "./auth";
import { getCompanyBranding } from "./companyBranding";

// Models pages: everyone in the company can view (agents included); the
// company admin edits, and so does the super admin for the company picked in
// the switcher (pages carry it as ?companyId=).
export async function catalogViewProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role === "super_admin") return { props: { username: session.username, role: "super_admin" } };
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

export async function catalogEditProps(context) {
  const result = await catalogViewProps(context);
  const role = result.props?.role;
  if (role && role !== "admin" && role !== "super_admin") {
    const id = context.params?.id;
    return { redirect: { destination: id ? `/catalog/${id}` : "/catalog", permanent: false } };
  }
  return result;
}
