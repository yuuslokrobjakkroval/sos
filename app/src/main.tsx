import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <I18nProvider>
          <AuthProvider>
            <App />
            <Toaster />
          </AuthProvider>
        </I18nProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
