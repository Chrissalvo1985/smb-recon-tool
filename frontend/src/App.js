import React, { useEffect, Component } from 'react';
import SMBReconTool from './components/SMBReconTool';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold mb-4">Application Error</h1>
            <p className="text-muted-foreground mb-2">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <details className="text-left mt-4 mb-6">
              <summary className="cursor-pointer text-sm text-muted-foreground">Error details</summary>
              <pre className="mt-2 p-4 bg-muted rounded text-xs overflow-auto max-h-40">
                {this.state.error?.stack}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  useEffect(() => {
    // Set light mode by default
    document.documentElement.classList.remove('dark');
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground">
        <SMBReconTool />
      </div>
    </ErrorBoundary>
  );
}

export default App;