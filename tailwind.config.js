/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.js", "./components/**/*.js"],
  theme: {
    extend: {
      colors: {
        bg: "#f3f5f9",
        card: "#ffffff",
        border: "#e5e8f0",
        ink: "#1c2130",
        muted: "#6b7280",
        // Values come from CSS custom properties (see :root in
        // globals.css), overridden per-request by Layout.js when a company
        // has its own brandColor set — the rgb(... / <alpha-value>) form is
        // required for opacity-modifier classes like bg-accent/10 to work.
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--accent-hover-rgb) / <alpha-value>)",
          soft: "rgb(var(--accent-soft-rgb) / <alpha-value>)",
        },
        success: "#12b76a",
        danger: "#e5484d",
        warning: "#d48806",
        sidebar: {
          DEFAULT: "#161c2d",
          active: "#232a41",
          text: "#9aa4c0",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        "card-hover": "0 4px 16px rgba(16, 24, 40, 0.08), 0 1px 3px rgba(16, 24, 40, 0.06)",
        dropdown: "0 12px 32px rgba(16, 24, 40, 0.12)",
        modal: "0 20px 40px rgba(16, 24, 40, 0.15)",
        login: "0 20px 50px rgba(16, 24, 40, 0.08)",
        toast: "0 12px 32px rgba(16, 24, 40, 0.25)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      keyframes: {
        "toast-in": {
          from: { opacity: 0, transform: "translateY(12px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        "toast-in": "toast-in 0.25s ease",
      },
    },
  },
  plugins: [],
};
