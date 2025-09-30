
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import { AppLayout } from "./components/AppLayout";
import Help from "./pages/Help";
import { ErrorBoundary } from "./components/ErrorBoundary";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <ErrorBoundary>
        <div style={{ position: 'fixed', inset: 8, pointerEvents: 'none', zIndex: 9999 }}>
          <div style={{ position: 'absolute', right: 0, top: 0, background: '#0ea5e9', color: '#002', padding: '2px 6px', borderRadius: 4, opacity: 0.8, fontSize: 10 }}>
            UI booted
          </div>
        </div>
        <HashRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/help" element={<Help />} />
              <Route path="/setup" element={<Setup />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppLayout>
        </HashRouter>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
