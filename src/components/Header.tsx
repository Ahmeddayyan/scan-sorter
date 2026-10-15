import { nextTheme, useTheme, type ThemePreference } from '../state';
import { Icon, type IconName } from './Icon';
import './Header.css';

const THEME_ICON: Record<ThemePreference, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };
const THEME_NAME: Record<ThemePreference, string> = { system: 'Automatic', light: 'Light', dark: 'Dark' };

function Logo() {
  return (
    <svg className="brand__logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--color-accent)" />
      <rect x="9" y="7" width="12" height="16" rx="2" fill="#fff" fillOpacity="0.55" transform="rotate(-8 15 15)" />
      <rect x="11" y="8" width="12" height="16" rx="2" fill="#fff" />
      <path d="M14 13h6M14 16.5h6M14 20h3.5" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Header({ demo }: { demo: boolean }) {
  const { theme, cycle } = useTheme();
  const next = nextTheme(theme);
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Scan Sorter home">
          <Logo />
          <span className="brand__name">Scan Sorter</span>
        </a>
        {demo ? <span className="app-header__demo">Demo data</span> : null}
        <span className="app-header__privacy">
          <Icon name="lock" />
          <span>Files stay on your device</span>
        </span>
        <button
          type="button"
          className="icon-btn app-header__theme"
          onClick={cycle}
          aria-label={`Colour theme: ${THEME_NAME[theme]}. Switch to ${THEME_NAME[next]}.`}
          title={`Theme: ${THEME_NAME[theme]}`}
        >
          <Icon name={THEME_ICON[theme]} />
        </button>
      </div>
    </header>
  );
}
