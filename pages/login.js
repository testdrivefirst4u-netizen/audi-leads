import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FiEye, FiEyeOff, FiAlertCircle, FiLoader, FiCheck, FiUser, FiLock, FiArrowRight, FiShield } from "react-icons/fi";
import { getSessionFromCookieHeader } from "../lib/auth";
import BcMark from "../components/BcMark";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (session) {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: {} };
}

const HIGHLIGHTS = [
  "Facebook & Instagram leads arrive on their own",
  "Follow-ups due today, so no test drive slips",
  "Reports by model, source and sales agent",
];

// A long-hood GT coupé, facing right, standing on y=215. No badge on purpose.
const CAR_BODY =
  "M168 196C162 196 157 191 157 184V170C157 161 162 155 171 152L198 146C244 134 270 112 318 104C352 98 392 97 422 103C446 108 466 124 488 135C522 140 566 146 592 156C606 161 613 170 613 180V190C613 194 610 196 606 196H554A34 34 0 0 0 486 196H279A34 34 0 0 0 211 196Z";
const WHEELS = [245, 520];
const SPOKES = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

function Wheel({ cx, p }) {
  return (
    <g transform={`translate(${cx} 187)`}>
      <circle r="28" fill="#07090f" />
      <circle r="26" fill="none" stroke="#1c2233" strokeWidth="2" />
      <circle r="20" fill={`url(#${p}-rim)`} />
      <circle r="17.5" fill="#1a2136" />
      {/* brake caliper sits still behind the turning spokes */}
      <path d="M8 -12A14.5 14.5 0 0 1 14.2 3" stroke="#3D5AFE" strokeWidth="5" fill="none" strokeLinecap="round" />
      <g className="login-wheel">
        {SPOKES.map((a) => (
          <path key={a} d="M-1.6 -4.5L-2.6 -17.5H2.6L1.6 -4.5Z" fill={`url(#${p}-rim)`} transform={`rotate(${a})`} />
        ))}
        <circle r="5" fill="#c9d2ea" />
        <circle r="2.2" fill="#2a3350" />
      </g>
    </g>
  );
}

/** The car artwork. `p` prefixes the gradient ids so two cars can share a page. */
function CarArt({ p }) {
  return (
    <>
      <path className="login-beam" d="M606 166L705 140V200Z" fill={`url(#${p}-beam)`} />
      <g className="login-body">
        <path d={CAR_BODY} fill={`url(#${p}-paint)`} />
        {/* shoulder sheen */}
        <path
          d="M178 150C250 138 300 112 330 108C370 102 410 103 430 108C452 114 470 128 492 138C530 144 570 150 596 160L594 164C566 154 528 148 488 143C462 131 446 118 426 113C404 108 368 107 334 112C302 117 256 142 180 156Z"
          fill={`url(#${p}-sheen)`}
          opacity=".7"
        />
        {/* glass */}
        <path d="M258 141C282 124 304 113 332 110C362 107 394 107 414 111C432 115 448 126 462 139Q462 142 458 142H262Q256 142 258 141Z" fill={`url(#${p}-glass)`} />
        <path d="M300 141L350 109H372L322 141Z" fill={`url(#${p}-glassref)`} />
        <path d="M376 109C378 120 377 131 374 142" stroke="#2238c4" strokeWidth="5" fill="none" />
        {/* character lines, door, handle */}
        <path d="M190 160C280 150 420 150 488 152C540 154 576 160 600 168" stroke="#fff" strokeOpacity=".28" strokeWidth="1.2" fill="none" />
        <path d="M300 182C360 174 430 172 476 176" stroke="#000" strokeOpacity=".25" strokeWidth="1.6" fill="none" />
        <path d="M374 144C378 160 380 176 378 194" stroke="#000" strokeOpacity=".3" strokeWidth="1" fill="none" />
        <path d="M398 152H418" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
        {/* side skirt, mirror */}
        <path d="M279 196H486L482 189H284Z" fill="#06102e" opacity=".55" />
        <path d="M464 133C467 126 478 125 483 130L479 136Z" fill="#2238c4" />
        {/* LED headlight, tail light, intake, diffuser */}
        <path d="M574 157C588 159 600 164 609 170L606 173C596 168 584 163 572 160Z" fill="#eef4ff" />
        <path d="M158 160L184 154L186 158L158 165Z" fill="#ff3d5e" />
        <path d="M590 186H611" stroke="#06102e" strokeWidth="3" strokeLinecap="round" opacity=".7" />
        <path d="M160 190H196" stroke="#06102e" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      </g>
      {WHEELS.map((cx) => (
        <Wheel key={cx} cx={cx} p={p} />
      ))}
    </>
  );
}

function CarGradients({ p }) {
  return (
    <defs>
      <linearGradient id={`${p}-paint`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8fa4ff" />
        <stop offset=".28" stopColor="#4562f2" />
        <stop offset=".62" stopColor="#2238c4" />
        <stop offset="1" stopColor="#0c1a6e" />
      </linearGradient>
      <linearGradient id={`${p}-sheen`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset=".45" stopColor="#fff" stopOpacity=".55" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${p}-glass`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a4a80" />
        <stop offset="1" stopColor="#0a0f22" />
      </linearGradient>
      <linearGradient id={`${p}-glassref`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset=".5" stopColor="#fff" stopOpacity=".22" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${p}-rim`} cx=".4" cy=".35" r=".75">
        <stop offset="0" stopColor="#eef2ff" />
        <stop offset=".6" stopColor="#9aa6c6" />
        <stop offset="1" stopColor="#4a5574" />
      </radialGradient>
      <linearGradient id={`${p}-beam`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#cfe0ff" stopOpacity=".6" />
        <stop offset="1" stopColor="#cfe0ff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${p}-fade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".55" />
        <stop offset=".6" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <mask id={`${p}-refmask`} maskUnits="userSpaceOnUse" x="100" y="215" width="620" height="60">
        <rect x="100" y="215" width="620" height="60" fill={`url(#${p}-fade)`} />
      </mask>
      <radialGradient id={`${p}-shadow`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#000" stopOpacity=".75" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/**
 * The car on a showroom floor with a rolling road.
 * phase: "waiting" (off-screen until the page loader has gone), "driving" (drives in,
 * then cruises), "leaving" (signed in: revs and drives off). Motion lives in globals.css
 * under "Login car".
 */
function DrivingCar({ phase, p, className = "" }) {
  return (
    <div className={`login-scene is-${phase} relative w-full ${className}`} aria-hidden="true">
      <svg viewBox="110 70 600 200" className="block w-full h-auto">
        <defs>
          <radialGradient id={`${p}-floor`} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#5b74ff" stopOpacity=".35" />
            <stop offset="1" stopColor="#5b74ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${p}-horizon`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8ea2ff" stopOpacity="0" />
            <stop offset=".5" stopColor="#8ea2ff" stopOpacity=".55" />
            <stop offset="1" stopColor="#8ea2ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <ellipse cx="400" cy="222" rx="300" ry="30" fill={`url(#${p}-floor)`} />
        <path d="M110 215H710" stroke={`url(#${p}-horizon)`} strokeWidth="1" />
        <path className="login-lane" d="M110 250H710" stroke="#8ea2ff" strokeOpacity=".22" strokeWidth="2.5" strokeDasharray="26 18" />
        <g className="login-streaks" stroke="#8ea2ff" strokeWidth="2.5" strokeLinecap="round">
          <path d="M118 140H150" style={{ animationDelay: "0s" }} />
          <path d="M112 162H148" style={{ animationDelay: ".25s" }} />
          <path d="M120 184H150" style={{ animationDelay: ".12s" }} />
        </g>
      </svg>

      {/* the car is its own layer so it can drive across the floor */}
      <svg viewBox="110 70 600 200" className="login-car absolute inset-0 w-full h-auto overflow-visible">
        <CarGradients p={p} />
        <ellipse cx="384" cy="214" rx="245" ry="9" fill={`url(#${p}-shadow)`} />
        {/* mirror image on the glossy floor */}
        <g mask={`url(#${p}-refmask)`} opacity=".5">
          <g transform="translate(0 430) scale(1 -1)">
            <CarArt p={p} />
          </g>
        </g>
        <CarArt p={p} />
      </svg>
    </div>
  );
}

/** Small white car silhouette for the Sign in button once the details are right. */
function ButtonCar() {
  return (
    <svg viewBox="150 92 470 125" className="login-btn-car absolute top-1/2 h-[14px] w-auto" aria-hidden="true">
      <path d={CAR_BODY} fill="#fff" />
      {WHEELS.map((cx) => (
        <circle key={cx} cx={cx} cy="187" r="27" fill="#fff" />
      ))}
    </svg>
  );
}

// How long the car takes to drive off before the dashboard opens (matches login-drive-out in globals.css).
const DRIVE_OFF_MS = 1100;

const inputCls =
  "w-full h-12 rounded-xl border border-border bg-white pl-11 pr-3.5 text-[15px] text-ink placeholder:text-[#a0a7b8] transition-shadow focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [carPhase, setCarPhase] = useState("waiting");
  const [shake, setShake] = useState(false);

  // The car drives in once the BroaddCast page loader has cleared, so it isn't
  // hidden underneath it.
  useEffect(() => {
    if (!document.getElementById("bc-loader")) {
      setCarPhase("driving");
      return;
    }
    const observer = new MutationObserver(() => {
      if (!document.getElementById("bc-loader")) {
        observer.disconnect();
        setCarPhase("driving");
      }
    });
    observer.observe(document.body, { childList: true });
    const fallback = setTimeout(() => setCarPhase("driving"), 9000);
    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (signedIn) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Login failed");
      }
      // Right details: the car drives off, then the dashboard opens.
      setSignedIn(true);
      setCarPhase("leaving");
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => router.push("/"), reduceMotion ? 0 : DRIVE_OFF_MS);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      setShake(true);
    }
  }

  const checkCapsLock = (e) => setCapsLock(Boolean(e.getModifierState?.("CapsLock")));

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-card">
      <Head>
        <title>Sign in · Broaddcast Leads Platform</title>
      </Head>

      {/* Showroom panel */}
      <section
        aria-label="Broaddcast Automobile CRM"
        className="relative overflow-hidden text-white hidden lg:flex lg:flex-[1.2] flex-col p-12 xl:p-14 bg-[radial-gradient(ellipse_at_50%_115%,#24306a_0%,#161c2d_45%,#0c101d_100%)]"
      >
        {/* faint floor grid */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "linear-gradient(to bottom, transparent 30%, #000 75%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 30%, #000 75%, transparent)",
          }}
        />
        {/* showroom spotlight */}
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-[6%] w-[90%] h-[60%] pointer-events-none opacity-[0.12] blur-2xl"
          style={{
            background: "linear-gradient(to bottom, transparent, #b9c7ff 70%, transparent)",
            clipPath: "polygon(40% 0, 60% 0, 96% 100%, 4% 100%)",
          }}
        />

        <div className="relative flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/broaddcast-logo.svg" alt="Broaddcast" className="h-11 w-auto brightness-0 invert" />
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b9c7ff]">
            Automobile CRM
          </span>
        </div>

        <div className="relative mt-[8vh] xl:mt-[10vh]">
          <h2 className="m-0 text-[34px] xl:text-[40px] font-bold leading-[1.1] tracking-[-0.01em] max-w-[520px]">
            Every enquiry, test drive and booking{" "}
            <span className="bg-gradient-to-r from-[#9fb2ff] to-[#5b74ff] bg-clip-text text-transparent">in one place.</span>
          </h2>
          <ul className="list-none p-0 mt-7 mb-0 flex flex-col gap-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-center gap-3 text-[14px] text-[#aab4d4]">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/25 text-[#b9c7ff] shrink-0">
                  <FiCheck size={12} strokeWidth={3} />
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-auto -mx-6 xl:-mx-8">
          <DrivingCar phase={carPhase} p="lgd" />
        </div>
      </section>

      {/* Form */}
      <main className="relative flex-1 flex flex-col bg-[#f6f7fb] lg:bg-white">
        {/* phone: the car drives across a dark banner above the form */}
        <div className="lg:hidden relative overflow-hidden px-4 pt-6 pb-16 bg-[radial-gradient(ellipse_at_50%_120%,#24306a_0%,#161c2d_55%,#0c101d_100%)]">
          <div className="flex items-center justify-between px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/broaddcast-logo.svg" alt="Broaddcast" className="h-8 w-auto brightness-0 invert" />
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b9c7ff]">
              Automobile CRM
            </span>
          </div>
          <DrivingCar phase={carPhase} p="lgm" className="mt-3 max-w-[440px] mx-auto" />
        </div>

        <div className="flex-1 flex items-start lg:items-center justify-center px-4 sm:px-6 pb-10 lg:py-14">
          <div className="relative w-full max-w-[400px] -mt-12 lg:mt-0 rounded-2xl lg:rounded-none bg-white lg:bg-transparent shadow-login lg:shadow-none p-6 sm:p-8 lg:p-0">
            <div className="flex items-center gap-3 mb-8">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-[#232b48] to-[#0f1424] text-white shadow-[0_6px_16px_rgba(22,28,45,0.25)] shrink-0">
                <BcMark className="w-[24px] h-auto" />
              </div>
              <div className="leading-tight">
                <div className="text-[15px] font-bold text-ink">Broaddcast Leads Platform</div>
                <div className="text-[12px] text-muted">Automobile CRM</div>
              </div>
            </div>

            <h1 className="m-0 mb-2 text-[30px] font-bold text-ink leading-tight tracking-[-0.01em]">Welcome back</h1>
            <p className="text-[14px] text-muted m-0 mb-8">Sign in to view and manage your dealership&apos;s leads.</p>

            <form onSubmit={handleSubmit} className={shake ? "login-shake" : undefined} onAnimationEnd={() => setShake(false)}>
              <div className="mb-4">
                <label htmlFor="login-username" className="block text-[13px] font-semibold text-ink mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <FiUser size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa2b4] pointer-events-none" />
                  <input
                    id="login-username"
                    className={inputCls}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Your username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="mb-5">
                <label htmlFor="login-password" className="block text-[13px] font-semibold text-ink mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <FiLock size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa2b4] pointer-events-none" />
                  <input
                    id="login-password"
                    className={`${inputCls} !pr-12`}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={checkCapsLock}
                    onKeyDown={checkCapsLock}
                    onBlur={() => setCapsLock(false)}
                    placeholder="Your password"
                    autoComplete="current-password"
                    aria-describedby={capsLock ? "login-caps" : undefined}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg bg-transparent border-none cursor-pointer text-muted hover:text-ink hover:bg-bg"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <FiEyeOff size={17} /> : <FiEye size={17} />}
                  </button>
                </div>
                {capsLock && (
                  <p id="login-caps" className="hint !text-warning">
                    Caps Lock is on.
                  </p>
                )}
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-3 mb-4 text-[13px] text-danger font-medium">
                  <FiAlertCircle size={16} className="shrink-0 mt-px" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`group relative overflow-hidden w-full h-12 rounded-xl border-none text-white text-[15px] font-semibold flex items-center justify-center gap-2 cursor-pointer transition-[box-shadow,transform] disabled:cursor-not-allowed ${
                  signedIn
                    ? "bg-success shadow-[0_10px_24px_rgba(18,183,106,0.3)]"
                    : "bg-gradient-to-r from-accent to-[#2238c4] shadow-[0_10px_24px_rgba(61,90,254,0.3)] hover:shadow-[0_14px_30px_rgba(61,90,254,0.38)] active:translate-y-px disabled:opacity-70"
                }`}
              >
                {signedIn ? (
                  <>
                    <ButtonCar />
                    <FiCheck size={17} strokeWidth={3} />
                    Welcome! Starting your engine…
                  </>
                ) : loading ? (
                  <>
                    <FiLoader size={17} className="animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <FiArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>

            <p className="text-[13px] text-muted mt-5 mb-0">Forgot your password? Ask your company admin to reset it.</p>

            <div className="flex items-start gap-2 mt-6 rounded-xl bg-bg px-3.5 py-3 text-[12px] text-muted">
              <FiShield size={15} className="shrink-0 mt-px text-accent" />
              <span>Protected sign-in. After several wrong attempts, signing in is paused for a few minutes.</span>
            </div>

            <div className="flex items-center justify-between gap-3 mt-8 pt-5 border-t border-border text-[11px] text-muted">
              <span className="flex items-center gap-1.5 uppercase tracking-wide">
                Developed by
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/broaddcast-logo.svg" alt="Broaddcast" className="h-7 w-auto object-contain" />
              </span>
              <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
