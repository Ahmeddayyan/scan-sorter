import { ExportDialog } from './components/ExportDialog';
import { EmptyState } from './components/EmptyState';
import { GlobalDrop } from './components/GlobalDrop';
import { Header } from './components/Header';
import { Lightbox } from './components/Lightbox';
import { LiveRegion } from './components/LiveRegion';
import { NumberEditor } from './components/NumberEditor';
import { ReviewView } from './components/ReviewView';
import { Toasts } from './components/Toasts';
import { AppProvider, useApp } from './state';
import './App.css';

function Shell() {
  const { state } = useApp();
  const hasPages = Object.keys(state.pages).length > 0;
  const showReview = hasPages || state.running;
  const { editingPageId, lightboxPageId } = state.ui;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header demo={state.demo} />
      <main id="main" className="app__main">
        {showReview ? <ReviewView /> : <EmptyState />}
      </main>
      {showReview ? null : (
        <footer className="app__footer">
          <p>Scan Sorter runs entirely in your browser. No ads, no accounts, no tracking.</p>
        </footer>
      )}
      {editingPageId ? <NumberEditor pageId={editingPageId} /> : null}
      {lightboxPageId ? <Lightbox pageId={lightboxPageId} /> : null}
      <ExportDialog />
      <Toasts />
      <LiveRegion />
      <GlobalDrop />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
