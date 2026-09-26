import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Auxiliary windows must not mount App: it owns the gateway, model lifecycle,
// telemetry configuration and persistent history coordinator.
const windowKind = new URLSearchParams(window.location.search).get("window");
const root = createRoot(document.getElementById("root")!);
if (windowKind === "selection" || windowKind === "selection-bubble") {
  void import("./features/selection/SelectionWindow").then(({ SelectionWindow, SelectionBubble }) => {
    root.render(<StrictMode>{windowKind === "selection" ? <SelectionWindow /> : <SelectionBubble />}</StrictMode>);
  });
} else {
  void import("./App").then(({ default: App }) => root.render(<StrictMode><App /></StrictMode>));
}
