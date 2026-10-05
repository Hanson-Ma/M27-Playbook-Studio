// Keeps one crashing view from taking down the shell; shows the error with a retry.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./Feedback";

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary (e.g. the route). */
  resetKey?: unknown;
  /** Short name for the message ("Library"). */
  name?: string;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name ?? "view"}] crashed`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <EmptyState
        icon="warning"
        title={`${this.props.name ?? "This View"} Hit an Error`}
        body={<code style={{ fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{error.message}</code>}
        action={
          <Button variant="primary" icon="refresh" onClick={() => this.setState({ error: undefined })}>
            Try Again
          </Button>
        }
      />
    );
  }
}
