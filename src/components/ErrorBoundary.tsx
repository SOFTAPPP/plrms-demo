import { Component, type ReactNode } from 'react';
import { ErrorState } from './ui/core';

export class ErrorBoundary extends Component<{ children: ReactNode; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className={this.props.compact ? '' : 'grid min-h-[60vh] place-items-center'}>
          <ErrorState message={this.state.error.message || 'This view hit an unexpected problem.'}
            onRetry={() => this.setState({ error: null })} />
        </div>
      );
    }
    return this.props.children;
  }
}
