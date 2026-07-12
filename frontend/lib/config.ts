export const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:8000";

export function wsUrl(campaignId: string): string {
  const wsBase = BACKEND_BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/ws/campaign/${campaignId}`;
}
