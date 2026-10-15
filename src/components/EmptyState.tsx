import { Icon } from './Icon';
import { useFilePicker } from './useFilePicker';
import './EmptyState.css';

const STEPS = [
  { title: 'Add your scans', body: 'PDFs or phone photos, in any order.' },
  { title: 'Check the order', body: 'We read the page numbers and flag anything missing.' },
  { title: 'Download', body: 'Get one tidy, sorted PDF.' },
];

export function EmptyState() {
  const { input, pick } = useFilePicker();
  return (
    <div className="empty">
      <section className="empty__hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="empty__title">
          Put shuffled scans back in order.
        </h1>
        <p className="empty__lead">
          Drop a pile of scanned pages or photos. Scan Sorter reads the printed page numbers, sorts them, and
          tells you which pages are missing or doubled.
        </p>

        <button type="button" className="dropzone" onClick={pick}>
          <span className="dropzone__icon">
            <Icon name="upload" />
          </span>
          <span className="dropzone__title">Drop files here, or choose files</span>
          <span className="dropzone__hint">PDF, JPG, PNG or WebP. As many as you like. You can also paste images with Ctrl+V.</span>
          <span className="btn btn--primary btn--lg dropzone__cta">
            <Icon name="plus" /> Choose files
          </span>
        </button>
        {input}

        <p className="empty__privacy">
          <Icon name="lock" />
          <span>
            <strong>Your files never leave your device.</strong> Everything happens in this browser tab, with no
            uploads and no account, and it works offline.
          </span>
        </p>
      </section>

      <section className="empty__steps" aria-label="How it works">
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="steps__item">
              <span className="steps__n num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h2 className="steps__title">{step.title}</h2>
                <p className="muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="empty__demo muted">
          Just looking? <a href="?demo">Try it with sample pages</a>.
        </p>
      </section>
    </div>
  );
}
