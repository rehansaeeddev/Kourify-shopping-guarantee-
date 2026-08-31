import { createContext, useCallback, useContext, type ReactNode } from "react";

type ToastContextValue = {
  showToast: (message: string, options?: { isError?: boolean }) => void;
};

declare global {
  interface Window {
    shopify?: {
      toast?: {
        show: (message: string, options?: { isError?: boolean; duration?: number }) => void;
      };
    };
  }
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const showToast = useCallback((message: string, options?: { isError?: boolean }) => {
    window.shopify?.toast?.show(message, options);
  }, []);

  return <ToastContext.Provider value={{ showToast }}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
