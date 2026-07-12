import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        status: {
          pending: "#6b7280",
          running: "#2563eb",
          passed: "#16a34a",
          failed: "#dc2626",
          retrying: "#d97706",
          escalated: "#9333ea",
        },
      },
    },
  },
  plugins: [],
};

export default config;
