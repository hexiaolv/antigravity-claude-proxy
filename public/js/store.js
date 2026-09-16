/**
 * Global Store for Antigravity Console
 * Handles Translations, Toasts, and Shared Config
 */

document.addEventListener('alpine:init', () => {
    Alpine.store('global', {
        init() {
            // Hash-based routing
            const validTabs = ['dashboard', 'models', 'accounts', 'logs', 'settings'];
            const validSettingsTabs = ['ui', 'claude', 'models', 'server'];
            const getHash = () => window.location.hash.substring(1);

            const parseHash = (hash) => {
                const [tab, subtab] = hash.split('/');
                return { tab, subtab };
            };

            // 1. Initial load from hash
            const { tab: initialTab, subtab: initialSubtab } = parseHash(getHash());
            if (validTabs.includes(initialTab)) {
                this.activeTab = initialTab;
                if (initialTab === 'settings' && validSettingsTabs.includes(initialSubtab)) {
                    this.settingsTab = initialSubtab;
                }
            }

            // 2. Sync State -> URL
            Alpine.effect(() => {
                if (!validTabs.includes(this.activeTab)) return;
                let target = this.activeTab;
                if (this.activeTab === 'settings' && this.settingsTab !== 'ui') {
                    target = `settings/${this.settingsTab}`;
                }
                if (getHash() !== target) {
                    window.location.hash = target;
                }
            });

            // 3. Sync URL -> State (Back/Forward buttons)
            window.addEventListener('hashchange', () => {
                const { tab, subtab } = parseHash(getHash());
                if (validTabs.includes(tab)) {
                    if (this.activeTab !== tab) {
                        this.activeTab = tab;
                    }
                    if (tab === 'settings') {
                        this.settingsTab = validSettingsTabs.includes(subtab) ? subtab : 'ui';
                    }
                }
            });

            // 4. Initialize i18n
            this.initI18n();

            // 5. Fetch version from API
            this.fetchVersion();
        },

        async fetchVersion() {
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const data = await response.json();
                    if (data.version) {
                        this.version = data.version;
                    }
                    // Update maxAccounts in data store
                    if (data.config && typeof data.config.maxAccounts === 'number') {
                        Alpine.store('data').maxAccounts = data.config.maxAccounts;
                    }
                }
            } catch (error) {
                console.debug('Could not fetch version:', error);
            }
        },

        // App State
        version: '1.0.0',
        activeTab: 'dashboard',
        settingsTab: 'ui',
        webuiPassword: localStorage.getItem('antigravity_webui_password') || '',

        // i18n
        supportedLangs: ['zh', 'en', 'tr', 'id', 'pt'],
        userLang: localStorage.getItem('app_lang') || 'auto',
        lang: 'en',
        translations: window.translations || {},

        detectSystemLanguage() {
            const navLangs = navigator.languages || [navigator.language || 'en'];
            for (const l of navLangs) {
                if (!l) continue;
                const lower = l.toLowerCase();
                if (lower.startsWith('zh')) return 'zh';
                if (lower.startsWith('tr')) return 'tr';
                if (lower.startsWith('id')) return 'id';
                if (lower.startsWith('pt')) return 'pt';
                if (lower.startsWith('en')) return 'en';
            }
            return 'en';
        },

        initI18n() {
            this.lang = this.userLang === 'auto' ? this.detectSystemLanguage() : this.userLang;
            if (!this.supportedLangs.includes(this.lang)) {
                this.lang = 'en';
            }
            document.documentElement.setAttribute('lang', this.lang);
        },

        t(key, params = {}) {
            const currentDict = this.translations[this.lang] || {};
            const fallbackDict = this.translations['en'] || {};
            let str = currentDict[key];
            if (str === undefined || str === null || str === '') {
                str = fallbackDict[key];
            }
            if (str === undefined || str === null || str === '') {
                str = key;
            }
            if (typeof str === 'string' && params && typeof params === 'object') {
                Object.keys(params).forEach(p => {
                    const val = params[p] !== undefined ? params[p] : '';
                    str = str.split(`{${p}}`).join(val);
                });
            }
            return str;
        },

        setLang(l) {
            this.userLang = l;
            localStorage.setItem('app_lang', l);
            this.lang = l === 'auto' ? this.detectSystemLanguage() : l;
            if (!this.supportedLangs.includes(this.lang)) {
                this.lang = 'en';
            }
            document.documentElement.setAttribute('lang', this.lang);
            const dataStore = Alpine.store('data');
            if (dataStore && dataStore.computeQuotaRows) {
                dataStore.computeQuotaRows();
            }
        },

        showToast(message, type = 'info') {
            const id = Date.now();
            this.toast = { message, type, id };
            setTimeout(() => {
                if (this.toast && this.toast.id === id) this.toast = null;
            }, 3000);
        }
    });
});
