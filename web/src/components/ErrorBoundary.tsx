import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>The console hit an unexpected error. Reloading usually fixes it.</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
          Reload the console
        </button>
      </div>
    );
  }
}
