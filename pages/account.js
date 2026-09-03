import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import LogoUploadField from "../components/LogoUploadField";
import { useToast } from "../components/ToastProvider";
import { apiFetch } from "../lib/apiFetch";
import { getSessionFromCookieHeader } from "../lib/auth";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role !== "super_admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: { username: session.username } };
}

export default function AccountPage({ username: initialUsername }) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState(initialUsername);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/account")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setUsername(data.username);
          setAvatarUrl(data.avatarUrl || "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      toast("New password and confirmation don't match", { type: "err" });
      return;
    }
    if (newPassword && !currentPassword) {
      toast("Enter your current password to set a new one", { type: "err" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          avatarUrl,
          ...(newPassword ? { password: newPassword, currentPassword } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save account");
      toast("Account updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Username may have changed, and the sidebar/topbar's own props came
      // from this page's initial server-side render — a full reload picks
      // up the reissued session cookie everywhere at once instead of trying
      // to patch every consumer's local state individually.
      router.reload();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout username={username} role="super_admin">
      <h1 className="page-title">Account</h1>
      <div className="panel mt-6">
        <div className="panel-header">
          <h2>Your Profile</h2>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="hint">Loading...</div>
          ) : (
            <form onSubmit={handleSave} className="max-w-[480px] flex flex-col gap-4">
              <div className="field mb-0">
                <label>Avatar</label>
                <LogoUploadField value={avatarUrl} onChange={setAvatarUrl} folder="admin-avatars" shape="circle" />
                <div className="hint">Shown in the top navbar and account menu. Leave empty to use the BroaddCast icon.</div>
              </div>

              <div className="field mb-0">
                <label>Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} required />
                <div className="hint">This is what you sign in with — can be an email address.</div>
              </div>

              <div className="field mb-0">
                <label>Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Required only if setting a new password"
                  autoComplete="current-password"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="field mb-0">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    autoComplete="new-password"
                  />
                </div>
                <div className="field mb-0">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div>
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
}
