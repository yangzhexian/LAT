export type IconName = "translate" | "history" | "model" | "settings" | "swap" | "chevron" | "close" | "check" | "sun" | "moon" | "horizontal" | "vertical";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1",
    moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
    horizontal: "M3 4h18v16H3ZM12 4v16",
    vertical: "M3 4h18v16H3ZM3 12h18",
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
