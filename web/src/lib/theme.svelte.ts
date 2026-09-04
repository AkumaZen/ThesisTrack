// Ports frontend/app.js's currentTheme()/wireThemeToggle() theme handling.
class ThemeState {
	current = $state<'light' | 'dark'>('dark');

	init() {
		const saved = localStorage.getItem('theme');
		if (saved === 'light' || saved === 'dark') {
			this.current = saved;
		} else {
			this.current = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
		}
		document.documentElement.setAttribute('data-theme', this.current);
	}

	toggle() {
		this.current = this.current === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', this.current);
		localStorage.setItem('theme', this.current);
	}
}

export const theme = new ThemeState();
