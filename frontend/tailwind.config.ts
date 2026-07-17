import type { Config } from "tailwindcss";

// Token values are the single source of truth from design/mocks/foreman.css
// (the approved mocks) — theme.extend.colors.foreman.* is the ONLY palette.
// No default Tailwind slate/blue, no gradients, no purple (see CLAUDE.md).
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        foreman: {
          bg: "#F8F4EE",
          card: "#FFFEFC",
          line: "#E8E0D3",
          ink: "#1C1815",
          dim: "#8A8072",
          faint: "#B7AE9F",
          primary: "#46392C",
          link: "#B8894F",
          accent: "#B8894F",

          ok: "#7C9463",
          "ok-bg": "#EDF0E6",
          "ok-text": "#4E5E3C",

          run: "#3D362D",
          "run-bg": "#F1EDE6",
          "run-text": "#3D362D",

          retry: "#B8894F",
          "retry-bg": "#F5EEE1",
          "retry-text": "#7A5A2E",

          fail: "#B15D48",
          "fail-bg": "#F5E6E1",
          "fail-text": "#7C3F2E",

          queued: "#8A8072",
          "queued-bg": "#F1EDE6",
          "queued-text": "#5C5346",
        },
      },
      fontFamily: {
        ui: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "Cascadia Mono", "monospace"],
      },
      borderRadius: {
        card: "12px",
        ctl: "8px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.05)",
        drawer: "-12px 0 40px rgba(16, 24, 40, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
