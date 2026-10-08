import { getSessionFromCookieHeader } from "./auth";
import { getCompanyBranding } from "./companyBranding";

// Models pages: everyone in the company can view (agents included), the
// super admin views any company; only the company's own admin edits.
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
  if (role && role !== "admin") {
    const id = context.params?.id;
    return { redirect: { destination: id ? `/catalog/${id}` : "/catalog", permanent: false } };
  }
  return result;
}
