import React from "react";
import { AlertTriangle, RefreshCw, RotateCcw, Home, Sparkles } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[BrandGuard ErrorBoundary Caught Error]:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleResetState = () => {
    try {
      if (this.props.onReset) {
        this.props.onReset();
      } else {
        // Clear any stored active draft or cookies if needed
        sessionStorage.clear();
        window.location.hash = "#/creator";
        window.location.reload();
        return;
      }
    } catch (e) {
      console.warn("Reset error:", e);
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.hash = "#/creator";
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleResetState);
      }

      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-slate-950 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">BrandGuard Interface Recovered</h1>
                <p className="text-xs text-slate-400">
                  An unexpected error was safely caught. The application remains online and your data is safe.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 font-mono text-xs text-red-300 overflow-x-auto">
              <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider mb-1">
                Caught Error Details:
              </p>
              {this.state.error?.message || "Unknown rendering exception"}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              If an uploaded banner or draft has unusual properties, clicking below will safely clear the active draft and return you to the workspace demo scenario.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleResetState}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <Sparkles className="w-4 h-4" />
                <span>Recover &amp; Load Demo Scenario</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload Page</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
