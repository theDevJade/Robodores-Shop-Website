import { useEffect } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Keeps a pair of CSS custom properties updated with the current viewport size so
 * the entire UI can scale up or down smoothly across phones, desktops, and TVs.
 */
export function useViewportScale() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;

    const updateScale = () => {
      const width = window.innerWidth || 1280;
      const height = window.innerHeight || 800;
      const minDimension = Math.min(width, height);
      const maxDimension = Math.max(width, height);

      const scale = clamp(minDimension / 960, 0.75, 1.45);
      const baseRem = clamp(Math.min(minDimension / 28, maxDimension / 42), 14, 22);

      root.style.setProperty("--viewport-scale", scale.toFixed(3));
      root.style.setProperty("--viewport-rem", `${baseRem}px`);
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    window.addEventListener("orientationchange", updateScale);

    return () => {
      window.removeEventListener("resize", updateScale);
      window.removeEventListener("orientationchange", updateScale);
    };
  }, []);
}
