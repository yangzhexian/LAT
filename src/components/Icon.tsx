export type IconName = "translate" | "history" | "model" | "settings" | "swap" | "chevron" | "close" | "check";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    translate: "M4 5h12M10 3v2M6 5c0 5 4 9 8 11M14 5c0 5-4 9-10 12M14 21l4-10 4 10M16 17h4",
    history: "M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2",
    model: "M12 3v9M6.3 5.7a8 8 0 1 0 11.4 0",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    swap: "M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4",
    chevron: "m7 10 5 5 5-5",
    close: "m6 6 12 12M18 6 6 18",
    check: "m5 12 4 4L19 6",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
