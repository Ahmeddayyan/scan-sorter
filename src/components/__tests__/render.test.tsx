import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Server-render smoke tests: catches render-time crashes without needing a DOM. */
describe('App server render', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shows the empty state with the privacy promise', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    const { default: App } = await import('../../App');
    const html = renderToString(<App />);
    expect(html).toContain('Put shuffled scans back in order.');
    expect(html).toContain('never leave your device');
    expect(html).toContain('type="file"');
    expect(html).not.toContain('Download sorted PDF');
  });

  it('renders the whole review screen from demo data', async () => {
    vi.stubGlobal('window', { location: { search: '?demo' } });
    const { default: App } = await import('../../App');
    const html = renderToString(<App />);
    expect(html).toContain('Download sorted PDF');
    expect(html).toContain('Page 14 missing');
    expect(html).toContain('Remove duplicate scans');
    expect(html).toContain('Demo data');
    expect(html).toContain('p. 12');
    expect(html).toContain('p. iii');
    expect(html).not.toContain('Back to automatic order');
  });
});
