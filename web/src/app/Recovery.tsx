import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * The last thing between a thrown render and a white page.
 *
 * React unmounts the whole tree when a render throws, and an unmounted tree is
 * a blank body. Blank is white unless something outside the bundle says
 * otherwise, which is why boot.css paints black and why this renders a real
 * sentence rather than nothing. A person who hits this should be able to tell
 * that the product failed rather than that the internet did.
 *
 * A class, because React still has no functional error boundary.
 */
export class Recovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept on the console rather than sent anywhere: there is no error
    // reporting service in this product and inventing one here would be a
    // network call nobody asked for.
    console.error('lacuna: render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boot-recovery">
        <h1>Something in this page failed to render.</h1>
        <p>The rest of Lacuna is unaffected. Reload the page, and if it happens again the browser console has the error.</p>
        <span>RENDER FAILED</span>
      </div>
    );
  }
}
