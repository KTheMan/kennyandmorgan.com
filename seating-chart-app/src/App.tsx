import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { AdminGate } from "@/components/AdminGate";
import { VenueManager } from "@/components/VenueManager";
import { VenueGate } from "@/components/VenueGate";
import { useSlugParam } from "@/hooks/useSlugParam";
import { ThemeProvider } from "./components/ThemeProvider";

const queryClient = new QueryClient();

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
        <p className="text-muted-foreground mb-4">
          The app encountered an error. Your work is saved automatically.
        </p>
        <p className="text-sm text-muted-foreground mb-6 font-mono bg-muted p-3 rounded">
          {error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          Refresh Page
        </button>
      </div>
    </div>
  );
}

// Two entry points, chosen by whether ?v=<slug> is present:
//   - No slug: the admin-only venue manager (list/create charts).
//   - A slug: that chart, via VenueGate — which decides for itself
//     whether the visitor can view-only or edit (admin / correct PIN).
const App = () => {
  const { slug, navigateToSlug } = useSlugParam();

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <div className="flex flex-col h-screen">
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              {slug ? (
                <VenueGate slug={slug} onBackToManager={() => navigateToSlug(null)} />
              ) : (
                <AdminGate>
                  {(token) => <VenueManager token={token} onOpenVenue={navigateToSlug} />}
                </AdminGate>
              )}
            </TooltipProvider>
          </QueryClientProvider>
        </div>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
