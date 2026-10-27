// The page's theme, light or dark, kept current as the account menu changes
// it, for the charts that draw differently in each.

import { useEffect, useState } from 'react';

export function useTheme() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [theme, set] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => set(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}
