import { memo, useContext, useLayoutEffect, useRef } from "react";
import { MathJaxBaseContext } from "better-react-mathjax";

export const architectureTypesetEvent = "lat-architecture-typeset";

// Formulas only depend on their TeX, never on animation frames or selected explanations.
export const ArchitectureFormula = memo(function ArchitectureFormula({ tex, label }: { tex: string; label: string }) {
  const context = useContext(MathJaxBaseContext);
  const element = useRef<HTMLSpanElement>(null);
  const ready = context?.version === 3 ? context.promise : null;
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    let cancelled = false;
    const active = () => !cancelled && element.current === target && target.isConnected;
    const notify = () => {
      const EventType = target.ownerDocument.defaultView?.Event;
      if (active() && EventType) target.dispatchEvent(new EventType(architectureTypesetEvent, { bubbles: true }));
    };
    target.textContent = label;
    if (ready) void (async () => {
      try {
        const math = await ready;
        if (!active()) return;
        // Share MathJax's startup queue; one failed conversion must not poison later formulas.
        const work = math.startup.promise.then(async () => {
          if (!active()) return;
          // Convert an isolated expression, never pass a possibly detached React ref to typesetPromise.
          // Conversion does not register a MathItem in document.math and needs no global clear.
          const rendered: HTMLElement = await math.tex2chtmlPromise(tex, { display: false });
          if (!active()) return;
          // Standalone conversion needs CHTML's adaptive wrapper/glyph CSS refreshed explicitly.
          const stylesheet: HTMLStyleElement = math.chtmlStylesheet();
          if (!stylesheet.isConnected) target.ownerDocument.head.append(stylesheet);
          target.replaceChildren(rendered);
          notify();
        }).catch(() => { if (active()) { target.textContent = label; notify(); } });
        math.startup.promise = work;
        await work;
      } catch {
        if (active()) { target.textContent = label; notify(); }
      }
    })();
    return () => { cancelled = true; };
  }, [ready, tex, label]);
  return <span className="ma-formula" ref={element} aria-label={label} role="math" />;
});

export function texDimension(value: number | null | undefined, symbol = "d") {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : symbol;
}
