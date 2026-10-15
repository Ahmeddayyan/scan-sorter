import { PageGrid } from './PageGrid';
import { ProblemsBanner } from './ProblemsBanner';
import { ProcessingPanel } from './ProcessingPanel';
import { SummaryPanel } from './SummaryPanel';
import { Toolbar } from './Toolbar';
import './ReviewView.css';

export function ReviewView() {
  return (
    <div className="review">
      <h1 className="sr-only">Review your pages</h1>
      <Toolbar />
      <div className="review__stack">
        <ProblemsBanner />
        <ProcessingPanel />
        <div className="review__layout">
          <SummaryPanel />
          <div className="review__main">
            <p className="review__hint muted">
              Click a page number to correct it. Drag the handle to move a page. Open a page to see it larger.
            </p>
            <PageGrid />
          </div>
        </div>
      </div>
    </div>
  );
}
