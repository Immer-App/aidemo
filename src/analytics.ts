import type { ProviderId } from "./openai";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();

export const initAnalytics = () => {
  if (!measurementId || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if (window.gtag) {
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer?.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    anonymize_ip: true,
    send_page_view: true
  });
  window.gtag("event", "page_view", {
    page_title: document.title,
    page_location: window.location.href,
    page_path: window.location.pathname
  });
};

type EventParams = Record<string, string | number | boolean | undefined>;

export const trackEvent = (eventName: string, params: EventParams = {}) => {
  if (!measurementId || !window.gtag) {
    return;
  }
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  );
  window.gtag("event", eventName, cleanParams);
};

export const trackProviderToggle = (providerId: ProviderId, enabled: boolean) => {
  trackEvent("provider_toggled", {
    provider_id: providerId,
    enabled
  });
};

export const trackSelectionOnlyToggle = (enabled: boolean) => {
  trackEvent("selection_only_toggled", {
    enabled
  });
};
