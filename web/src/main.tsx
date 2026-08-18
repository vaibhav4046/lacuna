import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

/**
 * StrictMode stays on deliberately. Its double-invoked effects are the cheapest
 * standing check that the canvas engine's cleanup really mirrors the design's
 * componentWillUnmount: a listener or a rAF that leaks shows up here as a
 * doubled loop rather than as a slow page three routes later.
 */
const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
