/**
 * Settings Store
 */
document.addEventListener('alpine:init', () => {
    Alpine.store('settings', {
        refreshInterval: 60,
        logLimit: 2000,
        showExhausted: true,
        showHiddenModels: false,
        showAllAccounts: false,
        showConfigWarning: true,
        compact: false,
        redactMode: false,
        placeholderMode: false,
        placeholderIncludeReal: true,
        debugLogging: true,
        logExport: true,
        healthInspector: true,
        healthInspectorOpen: false,
        theme: 'system', // 'system' | 'light' | 'dark'
        port: 8080, // Display only

        init() {
            this.loadSettings();
            this.applyTheme(this.theme);

            // Listen for system theme changes
            if (window.matchMedia) {
                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                const handler = () => {
                    if (this.theme === 'system') this.applyTheme('system');
                };
                if (mq.addEventListener) mq.addEventListener('change', handler);
                else if (mq.addListener) mq.addListener(handler);
            }
        },

        setTheme(newTheme) {
            if (['system', 'light', 'dark'].includes(newTheme)) {
                this.theme = newTheme;
                this.applyTheme(newTheme);
                this.saveSettings(true);
            }
        },

        toggleThemeQuick() {
            const cycle = ['system', 'light', 'dark'];
            const nextIdx = (cycle.indexOf(this.theme) + 1) % cycle.length;
            this.setTheme(cycle[nextIdx]);
        },

        applyTheme(theme = this.theme) {
            let isDark = true;
            if (theme === 'system') {
                isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            } else {
                isDark = theme === 'dark';
            }

            const root = document.documentElement;
            if (isDark) {
                root.classList.remove('light');
                root.classList.add('dark');
                root.setAttribute('data-theme', 'dark');
            } else {
                root.classList.remove('dark');
                root.classList.add('light');
                root.setAttribute('data-theme', 'light');
            }
        },

        // Call this method when toggling settings in the UI
        toggle(key) {
            if (this.hasOwnProperty(key) && typeof this[key] === 'boolean') {
                this[key] = !this[key];
                this.saveSettings(true);
            }
        },

        loadSettings() {
            const saved = localStorage.getItem('antigravity_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(parsed).forEach(k => {
                    // Only load keys that exist in our default state (safety)
                    if (this.hasOwnProperty(k)) this[k] = parsed[k];
                });
            }
        },

        saveSettings(silent = false) {
            const toSave = {
                refreshInterval: this.refreshInterval,
                logLimit: this.logLimit,
                showExhausted: this.showExhausted,
                showHiddenModels: this.showHiddenModels,
                showAllAccounts: this.showAllAccounts,
                showConfigWarning: this.showConfigWarning,
                compact: this.compact,
                redactMode: this.redactMode,
                placeholderMode: this.placeholderMode,
                placeholderIncludeReal: this.placeholderIncludeReal,
                debugLogging: this.debugLogging,
                logExport: this.logExport,
                healthInspector: this.healthInspector,
                healthInspectorOpen: this.healthInspectorOpen,
                theme: this.theme
            };
            localStorage.setItem('antigravity_settings', JSON.stringify(toSave));

            if (!silent) {
                const store = Alpine.store('global');
                store.showToast(store.t('configSaved'), 'success');
            }

            // Trigger updates
            document.dispatchEvent(new CustomEvent('refresh-interval-changed'));
            if (Alpine.store('data')) {
                Alpine.store('data').computeQuotaRows();
            }
        }
    });
});
