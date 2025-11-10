import { useEffect } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getSafeArea = (edge: "top" | "bottom") => {
  if (typeof window === "undefined" || !("visualViewport" in window) || !window.visualViewport) {
    return 0;
  }
  if (edge === "top") {
    return window.visualViewport.offsetTop;
  }
  return Math.max(0, window.innerHeight - (window.visualViewport.height + window.visualViewport.offsetTop));
};

const detectProfile = () => {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth || 1280;
  const userAgent = navigator.userAgent || "";
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(userAgent);
  return width <= 900 || isMobileUA ? "mobile" : "desktop";
};

/**
 * Automatically scales the UI by detecting whether the viewport behaves like a mobile or desktop browser.
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
      const profile = detectProfile();
      const profileScale = profile === "mobile" ? 0.82 : 1;
      const profileRemBoost = profile === "mobile" ? 1.1 : 1;

      const baseScale = clamp(minDimension / 960, 0.65, 1.5);
      const computedScale = clamp(baseScale * profileScale, 0.58, 1.6);
      const baseRem = clamp(Math.min(minDimension / 28, maxDimension / 38), 13, 22) * profileRemBoost;

      root.style.setProperty("--viewport-scale", computedScale.toFixed(3));
      root.style.setProperty("--viewport-rem", `${baseRem}px`);
      root.style.setProperty("--safe-area-top", `${getSafeArea("top")}px`);
      root.style.setProperty("--safe-area-bottom", `${getSafeArea("bottom")}px`);
      root.setAttribute("data-device-profile", profile);
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    window.addEventListener("orientationchange", updateScale);
    window.visualViewport?.addEventListener("resize", updateScale);

    return () => {
      window.removeEventListener("resize", updateScale);
      window.removeEventListener("orientationchange", updateScale);
      window.visualViewport?.removeEventListener("resize", updateScale);
    };
  }, []);
}
