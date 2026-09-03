import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ChevronDownIcon, LogoutIcon, UserIcon } from "./icons";
import { apiFetch } from "../lib/apiFetch";

function roleLabelFor(role) {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "Agent";
}

const AVATAR_SIZE = {
  sm: { box: "w-[26px] h-[26px]", text: "text-[11px]", pad: "p-[3px]" },
  md: { box: "w-9 h-9", text: "text-sm", pad: "p-1" },
  lg: { box: "w-12 h-12", text: "text-lg", pad: "p-1.5" },
};

// The company's own logo when there is one (this is what makes the avatar
// recognizable at a glance across companies) — falls back to the classic
// initial-letter circle otherwise, same as before.
function Avatar({ logoUrl, initial, size = "sm" }) {
  const { box, text, pad } = AVATAR_SIZE[size];
  if (logoUrl) {
    return (
      <span className={`${box} ${pad} rounded-full bg-white border border-border flex items-center justify-center shrink-0 overflow-hidden`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" className="w-full h-full object-contain" />
      </span>
    );
  }
  return (
    <span
      className={`${box} rounded-full bg-gradient-to-br from-accent to-accent-hover text-white flex items-center justify-center ${text} font-bold shrink-0`}
    >
      {initial}
    </span>
  );
}

export default function ProfileMenu({ username, role, companyName, companyLogoUrl, onLogout }) {
  const router = useRouter();
  const isSuperAdmin = role === "super_admin";
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [ownAvatarUrl, setOwnAvatarUrl] = useState(null);
  const ref = useRef(null);

  // Super admin can set their own avatar on the Account page — that lives on
  // the Admin document, not in the session cookie, so it's fetched here
  // rather than threaded through every page's getServerSideProps. Falls back
  // to the platform icon.svg (companyLogoUrl, as passed by TopBar) until/unless
  // one is set.
  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    apiFetch("/api/account")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.avatarUrl) setOwnAvatarUrl(data.avatarUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  // Close the dropdown on outside click — same pattern as NotificationBell.
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!username) return null;

  const roleLabel = roleLabelFor(role);
  const initial = username.charAt(0).toUpperCase();
  const avatarLogoUrl = isSuperAdmin ? ownAvatarUrl || companyLogoUrl : companyLogoUrl;

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          className="flex items-center gap-2 h-[38px] pl-1.5 pr-2.5 rounded-[10px] border border-border bg-card text-ink cursor-pointer transition-colors duration-150 hover:bg-bg"
          onClick={() => setOpen((o) => !o)}
          aria-label="Account menu"
          aria-expanded={open}
        >
          <Avatar logoUrl={avatarLogoUrl} initial={initial} size="sm" />
          <span className="hidden sm:block text-[13px] font-semibold text-ink truncate max-w-[130px]">{username}</span>
          <ChevronDownIcon className={`shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute top-[calc(100%+8px)] right-0 w-64 bg-card border border-border rounded-xl shadow-dropdown z-50 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
              <Avatar logoUrl={avatarLogoUrl} initial={initial} size="md" />
              <div className="min-w-0 leading-tight">
                <div className="text-[13.5px] font-bold text-ink truncate">{username}</div>
                <div className="text-[11.5px] text-muted truncate">
                  {roleLabel}
                  {companyName ? ` · ${companyName}` : ""}
                </div>
              </div>
            </div>
            <div className="p-1.5">
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium text-ink/80 cursor-pointer transition-colors duration-150 hover:bg-bg"
                onClick={() => {
                  setOpen(false);
                  if (isSuperAdmin) {
                    router.push("/account");
                  } else {
                    setAccountOpen(true);
                  }
                }}
              >
                <UserIcon /> Account
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium text-danger cursor-pointer transition-colors duration-150 hover:bg-danger/10"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <LogoutIcon /> Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {accountOpen && (
        <div className="modal-backdrop" onClick={() => setAccountOpen(false)}>
          <div className="modal max-w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Account</h2>
              <button type="button" className="btn-sm" onClick={() => setAccountOpen(false)}>
                Close
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar logoUrl={companyLogoUrl} initial={initial} size="lg" />
                <div className="min-w-0 leading-tight">
                  <div className="text-[15px] font-bold text-ink truncate">{username}</div>
                  <div className="text-[12px] text-muted">{roleLabel}</div>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 text-[13.5px]">
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <span className="text-muted">Username</span>
                  <span className="font-medium text-ink">{username}</span>
                </div>
                <div className={`flex items-center justify-between ${companyName ? "border-b border-border pb-2.5" : ""}`}>
                  <span className="text-muted">Role</span>
                  <span className="font-medium text-ink">{roleLabel}</span>
                </div>
                {companyName && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Company</span>
                    <span className="font-medium text-ink">{companyName}</span>
                  </div>
                )}
              </div>

              <div className="hint">
                Password changes and profile edits aren&apos;t self-service yet — contact your administrator if you need
                either.
              </div>

              <button
                type="button"
                className="btn-sm self-start"
                style={{ color: "#b91c1c", borderColor: "#fca5a5" }}
                onClick={() => {
                  setAccountOpen(false);
                  onLogout();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
