// GET /api/meta/connection-status — same payload as GET /api/meta/settings
// (connection, connected pages with token status, webhook details, last
// webhook / last lead / last error), under the route name the integration
// spec asks for. One handler, two routes.
export { default } from "./settings";
