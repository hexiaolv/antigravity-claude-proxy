/**
 * Data Store
 * Holds Accounts, Models, and Computed Quota Rows
 * Shared between Dashboard and AccountManager
 */

// utils is loaded globally as window.utils in utils.js

document.addEventListener('alpine:init', () => {
    Alpine.store('data', {
        accounts: [],
        models: [], // Source of truth
        modelConfig: {}, // Model metadata (hidden, pinned, alias)
        quotaRows: [], // Filtered view
        usageHistory: {}, // Usage statistics history (from /account-limits?includeHistory=true)
        globalQuotaThreshold: 0, // Global minimum quota threshold (fraction 0-0.99)
        maxAccounts: 10, // Maximum number of accounts allowed (from config)
        devMode: false, // Developer mode flag (from server config)
        placeholderMode: false, // Inject placeholder account data for UI testing
        placeholderIncludeReal: true, // Include real accounts alongside placeholder data
        _realAccounts: null, // Stash for real accounts when placeholder mode is on
        _realModels: null, // Stash for real models when placeholder mode is on
        loading: false,
        initialLoad: true, // Track first load for skeleton screen
        connectionStatus: 'connecting',
        lastUpdated: '-',
        healthCheckTimer: null,

        // Filters state
        filters: {
            account: 'all',
            family: 'all',
            search: '',
            sortCol: 'avgQuota',
            sortAsc: true
        },

        // Category-level quotas (Gemini / Claude&GPT)
        categorySummary: {
            gemini: {
                fiveHour: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                weekly: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                healthyCount: 0,
                totalCount: 0
            },
            claude: {
                fiveHour: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                weekly: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                healthyCount: 0,
                totalCount: 0
            }
        },
        accountCategoryCards: [],

        // Settings for calculation
        // We need to access global settings? Or duplicate?
        // Let's assume settings are passed or in another store.
        // For simplicity, let's keep relevant filters here.

        init() {
            // Restore from cache first for instant render
            this.loadFromCache();

            // Restore placeholder mode from persisted settings
            // Read localStorage directly since settings store may not be initialized yet
            try {
                const saved = JSON.parse(localStorage.getItem('antigravity_settings') || '{}');
                if (saved.placeholderMode) {
                    this.setPlaceholderMode(true, saved.placeholderIncludeReal !== false);
                }
            } catch (e) { /* ignore parse errors */ }

            // Watch filters to recompute
            // Alpine stores don't have $watch automatically unless inside a component?
            // We can manually call compute when filters change.

            // Start health check monitoring
            this.startHealthCheck();
        },

        loadFromCache() {
            try {
                const cached = localStorage.getItem('ag_data_cache');
                if (cached) {
                    const data = JSON.parse(cached);
                    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

                    // Check TTL
                    if (data.timestamp && (Date.now() - data.timestamp > CACHE_TTL)) {
                        if (window.UILogger) window.UILogger.debug('Cache expired, skipping restoration');
                        localStorage.removeItem('ag_data_cache');
                        return;
                    }

                    // Basic validity check
                    if (data.accounts && data.models) {
                        this.accounts = data.accounts;
                        this.models = data.models;
                        this.modelConfig = data.modelConfig || {};
                        this.usageHistory = data.usageHistory || {};

                        // Don't show loading on initial load if we have cache
                        this.initialLoad = false;
                        this.computeQuotaRows();
                        if (window.UILogger) window.UILogger.debug('Restored data from cache');
                    }
                }
            } catch (e) {
                if (window.UILogger) window.UILogger.debug('Failed to load cache', e.message);
            }
        },

        saveToCache() {
            try {
                const cacheData = {
                    accounts: this.accounts,
                    models: this.models,
                    modelConfig: this.modelConfig,
                    usageHistory: this.usageHistory,
                    timestamp: Date.now()
                };
                localStorage.setItem('ag_data_cache', JSON.stringify(cacheData));
            } catch (e) {
                if (window.UILogger) window.UILogger.debug('Failed to save cache', e.message);
            }
        },

        _isFetching: false,
        async fetchData() {
            // Prevent concurrent/overlapping fetch operations from exhausting browser connection slots
            if (this._isFetching) {
                return;
            }
            this._isFetching = true;

            // Only show skeleton on initial load if we didn't restore from cache
            if (this.initialLoad) {
                this.loading = true;
            }
            try {
                // Get password from global store
                const password = Alpine.store('global').webuiPassword;

                // Include history for dashboard (single API call optimization)
                const url = '/account-limits?includeHistory=true';
                const { response, newPassword } = await window.utils.request(url, {}, password, 15000);

                if (newPassword) Alpine.store('global').webuiPassword = newPassword;

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                this.accounts = data.accounts || [];
                if (data.models && data.models.length > 0) {
                    this.models = data.models;
                }
                this.modelConfig = data.modelConfig || {};
                this.globalQuotaThreshold = data.globalQuotaThreshold || 0;

                // Store usage history if included (for dashboard)
                if (data.history) {
                    this.usageHistory = data.history;
                }

                this.saveToCache(); // Save fresh data

                // Re-inject placeholder data if active
                if (this.placeholderMode) {
                    this._realAccounts = [...this.accounts];
                    this._realModels = [...this.models];
                    const { accounts: fakeAccounts, models: fakeModels } = this._generatePlaceholderData();
                    if (this.placeholderIncludeReal) {
                        this.accounts = [...this._realAccounts, ...fakeAccounts];
                        const modelSet = new Set([...this._realModels, ...fakeModels]);
                        this.models = Array.from(modelSet).sort();
                    } else {
                        this.accounts = fakeAccounts;
                        this.models = fakeModels;
                    }
                }

                this.computeQuotaRows();

                this.lastUpdated = new Date().toLocaleTimeString();
            } catch (error) {
                // Keep error logging for actual fetch failures
                console.error('Fetch error:', error);
                const store = Alpine.store('global');
                store.showToast(store.t('connectionLost'), 'error');
            } finally {
                this._isFetching = false;
                this.loading = false;
                this.initialLoad = false; // Mark initial load as complete
            }
        },

        _isHealthChecking: false,
        async performHealthCheck() {
            if (this._isHealthChecking) {
                return;
            }
            this._isHealthChecking = true;
            try {
                // Get password from global store
                const password = Alpine.store('global').webuiPassword;

                // Use lightweight endpoint (no quota fetching) with 8s timeout
                const { response, newPassword } = await window.utils.request('/api/config', {}, password, 8000);

                if (newPassword) Alpine.store('global').webuiPassword = newPassword;

                if (response.ok) {
                    this.connectionStatus = 'connected';
                    // Update devMode from server config
                    try {
                        const data = await response.json();
                        if (data.config) {
                            this.devMode = !!data.config.devMode;
                        }
                    } catch (e) { /* ignore parse errors */ }
                } else {
                    this.connectionStatus = 'disconnected';
                }
            } catch (error) {
                console.error('Health check error:', error);
                this.connectionStatus = 'disconnected';
            } finally {
                this._isHealthChecking = false;
            }
        },

        startHealthCheck() {
            // Clear existing timer
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
            }

            // Setup visibility change listener (only once)
            if (!this._healthVisibilitySetup) {
                this._healthVisibilitySetup = true;
                this._visibilityHandler = () => {
                    if (document.hidden) {
                        // Tab hidden - stop health checks
                        this.stopHealthCheck();
                    } else {
                        // Tab visible - restart health checks
                        this.startHealthCheck();
                    }
                };
                document.addEventListener('visibilitychange', this._visibilityHandler);
            }

            // Perform immediate health check
            this.performHealthCheck();

            // Schedule regular health checks every 15 seconds
            this.healthCheckTimer = setInterval(() => {
                // Only perform health check if tab is visible
                if (!document.hidden) {
                    this.performHealthCheck();
                }
            }, 15000);
        },

        stopHealthCheck() {
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = null;
            }
        },

        computeQuotaRows() {
            const models = this.models || [];
            const rows = [];
            const showExhausted = Alpine.store('settings')?.showExhausted ?? true;

            models.forEach(modelId => {
                // Config
                const config = this.modelConfig[modelId] || {};
                const family = this.getModelFamily(modelId);

                // Visibility Logic for Models Page (quotaRows):
                // 1. If explicitly hidden via config, ALWAYS hide (clean interface)
                // 2. If no config, default 'unknown' families to HIDDEN
                // 3. Known families (Claude/Gemini) default to VISIBLE
                // Note: To manage hidden models, use Settings → Models tab
                let isHidden = config.hidden;
                if (isHidden === undefined) {
                    isHidden = (family === 'other' || family === 'unknown');
                }

                // Models Page: Check settings for visibility
                const showHidden = Alpine.store('settings')?.showHiddenModels ?? false;
                if (isHidden && !showHidden) return;

                // Filters
                if (this.filters.family !== 'all' && this.filters.family !== family) return;
                if (this.filters.search) {
                    const searchLower = this.filters.search.toLowerCase();
                    const idMatch = modelId.toLowerCase().includes(searchLower);
                    if (!idMatch) return;
                }

                // Data Collection
                const quotaInfo = [];
                let minQuota = 100;
                let totalQuotaSum = 0;
                let validAccountCount = 0;
                let totalWeeklySum = 0;
                let validWeeklyCount = 0;
                let minResetTime = null;
                let minWeeklyResetTime = null;
                let maxEffectiveThreshold = 0;
                const globalThreshold = this.globalQuotaThreshold || 0;

                this.accounts.forEach(acc => {
                    if (acc.enabled === false) return;
                    if (this.filters.account !== 'all' && acc.email !== this.filters.account) return;

                    const limit = acc.limits?.[modelId];
                    if (!limit) return;

                    const pct = limit.remainingFraction !== null ? Math.round(limit.remainingFraction * 100) : 0;
                    minQuota = Math.min(minQuota, pct);

                    // Accumulate for average
                    totalQuotaSum += pct;
                    validAccountCount++;

                    if (limit.resetTime && (!minResetTime || new Date(limit.resetTime) < new Date(minResetTime))) {
                        minResetTime = limit.resetTime;
                    }

                    const weeklyInfo = this.getWeeklyQuotaInfo(acc, modelId);
                    const weeklyResetTime = weeklyInfo?.resetTime || null;
                    const weeklyPct = weeklyInfo?.pct ?? null;

                    if (weeklyPct !== null) {
                        totalWeeklySum += weeklyPct;
                        validWeeklyCount++;
                    }

                    if (weeklyResetTime && (!minWeeklyResetTime || new Date(weeklyResetTime) < new Date(minWeeklyResetTime))) {
                        minWeeklyResetTime = weeklyResetTime;
                    }

                    // Resolve effective threshold: per-model > per-account > global
                    const accModelThreshold = acc.modelQuotaThresholds?.[modelId];
                    const accThreshold = acc.quotaThreshold;
                    const effective = accModelThreshold ?? accThreshold ?? globalThreshold;
                    if (effective > maxEffectiveThreshold) {
                        maxEffectiveThreshold = effective;
                    }

                    // Determine threshold source for display
                    let thresholdSource = 'global';
                    if (accModelThreshold !== undefined) thresholdSource = 'model';
                    else if (accThreshold !== undefined) thresholdSource = 'account';

                    quotaInfo.push({
                        email: acc.email.split('@')[0],
                        fullEmail: acc.email,
                        pct: pct,
                        weeklyPct,
                        weeklyUsedPct: weeklyPct !== null ? (100 - weeklyPct) : null,
                        resetTime: limit.resetTime,
                        weeklyResetTime,
                        thresholdPct: Math.round(effective * 100),
                        thresholdSource
                    });
                });

                if (quotaInfo.length === 0) return;
                const avgQuota = validAccountCount > 0 ? Math.round(totalQuotaSum / validAccountCount) : 0;
                const avgWeeklyQuota = validWeeklyCount > 0 ? Math.round(totalWeeklySum / validWeeklyCount) : null;
                const avgWeeklyUsedPct = avgWeeklyQuota !== null ? (100 - avgWeeklyQuota) : null;

                if (!showExhausted && minQuota === 0) return;

                // Check if thresholds vary across accounts
                const uniqueThresholds = new Set(quotaInfo.map(q => q.thresholdPct));
                const hasVariedThresholds = uniqueThresholds.size > 1;

                rows.push({
                    modelId,
                    displayName: modelId, // Simplified: no longer using alias
                    family,
                    minQuota,
                    avgQuota, // Added Average Quota
                    avgWeeklyQuota,
                    avgWeeklyUsedPct,
                    minResetTime,
                    resetIn: minResetTime ? window.utils.formatTimeUntil(minResetTime) : '-',
                    minWeeklyResetTime,
                    weeklyResetIn: minWeeklyResetTime ? window.utils.formatTimeUntil(minWeeklyResetTime) : '-',
                    quotaInfo,
                    pinned: !!config.pinned,
                    hidden: !!isHidden, // Use computed visibility
                    activeCount: quotaInfo.filter(q => q.pct > 0).length,
                    effectiveThresholdPct: Math.round(maxEffectiveThreshold * 100),
                    hasVariedThresholds
                });
            });

            // Sort: Pinned first, then by selected column
            const sortCol = this.filters.sortCol;
            const sortAsc = this.filters.sortAsc;

            this.quotaRows = rows.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

                let valA = a[sortCol];
                let valB = b[sortCol];

                // Handle nulls (always push to bottom)
                if (valA === valB) return 0;
                if (valA === null || valA === undefined) return 1;
                if (valB === null || valB === undefined) return -1;

                if (typeof valA === 'string' && typeof valB === 'string') {
                    return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }

                return sortAsc ? valA - valB : valB - valA;
            });

            // Recompute category summaries and per-account cards
            this.computeCategorySummaries();
        },

        extractAccountCategory(acc) {
            if (!acc) return null;
            const res = {
                email: acc.email,
                displayEmail: window.Redact ? window.Redact.email(acc.email) : acc.email,
                shortEmail: (acc.email || '').split('@')[0],
                tier: acc.subscription?.tier || 'free',
                projectId: acc.subscription?.projectId || '',
                enabled: acc.enabled !== false,
                gemini: {
                    displayName: 'Gemini Models',
                    fiveHour: { pct: 100, remainingFraction: 1, resetTime: null, noticeText: '' },
                    weekly: { pct: 100, remainingFraction: 1, resetTime: null, noticeText: '' }
                },
                claude: {
                    displayName: 'Claude and GPT models',
                    fiveHour: { pct: 100, remainingFraction: 1, resetTime: null, noticeText: '' },
                    weekly: { pct: 100, remainingFraction: 1, resetTime: null, noticeText: '' }
                }
            };

            const groups = acc.quotaSummary?.groups || acc.quota?.summary?.groups;
            if (Array.isArray(groups) && groups.length > 0) {
                groups.forEach(g => {
                    const gName = (g.displayName || '').toLowerCase();
                    const isGemini = gName.includes('gemini');
                    const isClaude = gName.includes('claude') || gName.includes('gpt');
                    const targetCategory = isGemini ? res.gemini : (isClaude ? res.claude : null);
                    if (!targetCategory) return;

                    (g.buckets || []).forEach(b => {
                        const isWeekly = b.window === 'weekly' || (b.bucketId && b.bucketId.includes('weekly'));
                        const targetBucket = isWeekly ? targetCategory.weekly : targetCategory.fiveHour;
                        const frac = typeof b.remainingFraction === 'number' ? b.remainingFraction : 1;
                        const pct = Math.round(frac * 100);
                        targetBucket.remainingFraction = frac;
                        targetBucket.pct = pct;
                        targetBucket.resetTime = b.resetTime || null;
                        targetBucket.noticeText = window.utils.formatRefreshNotice(isWeekly ? 'weekly' : '5h', pct, b.resetTime);
                    });
                });
            } else {
                // Fallback using individual model limits
                const geminiFractions = [];
                const claudeFractions = [];
                let geminiReset = null;
                let claudeReset = null;

                Object.entries(acc.limits || {}).forEach(([modelId, limit]) => {
                    if (!limit || limit.remainingFraction === null || limit.remainingFraction === undefined) return;
                    const isClaude = modelId.includes('claude') || modelId.includes('gpt');
                    if (isClaude) {
                        claudeFractions.push(limit.remainingFraction);
                        if (limit.resetTime && (!claudeReset || new Date(limit.resetTime) < new Date(claudeReset))) {
                            claudeReset = limit.resetTime;
                        }
                    } else if (modelId.includes('gemini')) {
                        geminiFractions.push(limit.remainingFraction);
                        if (limit.resetTime && (!geminiReset || new Date(limit.resetTime) < new Date(geminiReset))) {
                            geminiReset = limit.resetTime;
                        }
                    }
                });

                if (geminiFractions.length > 0) {
                    const avg = geminiFractions.reduce((a, b) => a + b, 0) / geminiFractions.length;
                    const pct = Math.round(avg * 100);
                    res.gemini.fiveHour = {
                        pct,
                        remainingFraction: avg,
                        resetTime: geminiReset,
                        noticeText: window.utils.formatRefreshNotice('5h', pct, geminiReset)
                    };
                }
                if (claudeFractions.length > 0) {
                    const avg = claudeFractions.reduce((a, b) => a + b, 0) / claudeFractions.length;
                    const pct = Math.round(avg * 100);
                    res.claude.fiveHour = {
                        pct,
                        remainingFraction: avg,
                        resetTime: claudeReset,
                        noticeText: window.utils.formatRefreshNotice('5h', pct, claudeReset)
                    };
                }
            }

            return res;
        },

        computeCategorySummaries() {
            const accounts = this.accounts || [];
            const cards = [];
            const summary = {
                gemini: {
                    fiveHour: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                    weekly: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                    healthyCount: 0,
                    totalCount: 0
                },
                claude: {
                    fiveHour: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                    weekly: { avgPct: 100, earliestReset: null, earliestAccount: null, noticeText: '' },
                    healthyCount: 0,
                    totalCount: 0
                }
            };

            let g5hSum = 0, g5hCount = 0;
            let gWkSum = 0, gWkCount = 0;
            let c5hSum = 0, c5hCount = 0;
            let cWkSum = 0, cWkCount = 0;

            accounts.forEach(acc => {
                if (acc.enabled === false) return;
                const card = this.extractAccountCategory(acc);
                if (!card) return;

                // Account filter
                if (this.filters.account !== 'all' && acc.email !== this.filters.account) return;

                // Search filter
                if (this.filters.search) {
                    const term = this.filters.search.toLowerCase();
                    const matches = acc.email.toLowerCase().includes(term) || (acc.subscription?.projectId || '').toLowerCase().includes(term);
                    if (!matches) return;
                }

                cards.push(card);

                // Aggregate Gemini
                summary.gemini.totalCount++;
                if (card.gemini.fiveHour.pct > 0 || card.gemini.weekly.pct > 0) summary.gemini.healthyCount++;

                g5hSum += card.gemini.fiveHour.pct;
                g5hCount++;
                if (card.gemini.fiveHour.resetTime) {
                    if (!summary.gemini.fiveHour.earliestReset || new Date(card.gemini.fiveHour.resetTime) < new Date(summary.gemini.fiveHour.earliestReset)) {
                        summary.gemini.fiveHour.earliestReset = card.gemini.fiveHour.resetTime;
                        summary.gemini.fiveHour.earliestAccount = card.shortEmail;
                    }
                }

                gWkSum += card.gemini.weekly.pct;
                gWkCount++;
                if (card.gemini.weekly.resetTime) {
                    if (!summary.gemini.weekly.earliestReset || new Date(card.gemini.weekly.resetTime) < new Date(summary.gemini.weekly.earliestReset)) {
                        summary.gemini.weekly.earliestReset = card.gemini.weekly.resetTime;
                        summary.gemini.weekly.earliestAccount = card.shortEmail;
                    }
                }

                // Aggregate Claude
                summary.claude.totalCount++;
                if (card.claude.fiveHour.pct > 0 || card.claude.weekly.pct > 0) summary.claude.healthyCount++;

                c5hSum += card.claude.fiveHour.pct;
                c5hCount++;
                if (card.claude.fiveHour.resetTime) {
                    if (!summary.claude.fiveHour.earliestReset || new Date(card.claude.fiveHour.resetTime) < new Date(summary.claude.fiveHour.earliestReset)) {
                        summary.claude.fiveHour.earliestReset = card.claude.fiveHour.resetTime;
                        summary.claude.fiveHour.earliestAccount = card.shortEmail;
                    }
                }

                cWkSum += card.claude.weekly.pct;
                cWkCount++;
                if (card.claude.weekly.resetTime) {
                    if (!summary.claude.weekly.earliestReset || new Date(card.claude.weekly.resetTime) < new Date(summary.claude.weekly.earliestReset)) {
                        summary.claude.weekly.earliestReset = card.claude.weekly.resetTime;
                        summary.claude.weekly.earliestAccount = card.shortEmail;
                    }
                }
            });

            summary.gemini.fiveHour.avgPct = g5hCount > 0 ? Math.round(g5hSum / g5hCount) : 100;
            summary.gemini.fiveHour.noticeText = window.utils.formatRefreshNotice('5h', summary.gemini.fiveHour.avgPct, summary.gemini.fiveHour.earliestReset);
            summary.gemini.weekly.avgPct = gWkCount > 0 ? Math.round(gWkSum / gWkCount) : 100;
            summary.gemini.weekly.noticeText = window.utils.formatRefreshNotice('weekly', summary.gemini.weekly.avgPct, summary.gemini.weekly.earliestReset);

            summary.claude.fiveHour.avgPct = c5hCount > 0 ? Math.round(c5hSum / c5hCount) : 100;
            summary.claude.fiveHour.noticeText = window.utils.formatRefreshNotice('5h', summary.claude.fiveHour.avgPct, summary.claude.fiveHour.earliestReset);
            summary.claude.weekly.avgPct = cWkCount > 0 ? Math.round(cWkSum / cWkCount) : 100;
            summary.claude.weekly.noticeText = window.utils.formatRefreshNotice('weekly', summary.claude.weekly.avgPct, summary.claude.weekly.earliestReset);

            this.categorySummary = summary;
            this.accountCategoryCards = cards;
        },

        setSort(col) {
            if (this.filters.sortCol === col) {
                this.filters.sortAsc = !this.filters.sortAsc;
            } else {
                this.filters.sortCol = col;
                // Default sort direction: Descending for numbers/stats, Ascending for text/time
                if (['avgQuota', 'activeCount'].includes(col)) {
                    this.filters.sortAsc = false;
                } else {
                    this.filters.sortAsc = true;
                }
            }
            this.computeQuotaRows();
        },

        getModelFamily(modelId) {
            const lower = (modelId || '').toLowerCase();
            if (lower.includes('claude')) return 'claude';
            if (lower.includes('gemini')) return 'gemini';
            return 'other';
        },

        getWeeklyResetTime(acc, modelId) {
            return this.getWeeklyQuotaInfo(acc, modelId)?.resetTime || null;
        },

        getWeeklyQuotaInfo(acc, modelId) {
            if (!acc) return null;
            const groups = acc.quotaSummary?.groups || acc.quota?.summary?.groups;
            if (!groups || !Array.isArray(groups)) return null;

            const lower = (modelId || '').toLowerCase();
            const isClaudeOrGpt = lower.includes('claude') || lower.includes('gpt');

            for (const group of groups) {
                const gName = (group.displayName || '').toLowerCase();
                const isClaudeGroup = gName.includes('claude') || gName.includes('gpt');
                const isGeminiGroup = gName.includes('gemini');

                if ((isClaudeOrGpt && isClaudeGroup) || (!isClaudeOrGpt && isGeminiGroup)) {
                    const bucket = (group.buckets || []).find(b =>
                        b.window === 'weekly' || (b.bucketId && b.bucketId.includes('weekly'))
                    );
                    if (bucket) {
                        const fraction = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : null;
                        const pct = fraction !== null ? Math.round(fraction * 100) : null;
                        return {
                            remainingFraction: fraction,
                            pct,
                            usedPct: pct !== null ? (100 - pct) : null,
                            resetTime: bucket.resetTime || null
                        };
                    }
                }
            }
            return null;
        },

        /**
         * Get quota data without filters applied (for Dashboard global charts)
         * Returns array of { modelId, family, quotaInfo: [{pct}] }
         */
        getUnfilteredQuotaData() {
            const models = this.models || [];
            const rows = [];
            const showHidden = Alpine.store('settings')?.showHiddenModels ?? false;

            models.forEach(modelId => {
                const config = this.modelConfig[modelId] || {};
                const family = this.getModelFamily(modelId);

                // Smart visibility (same logic as computeQuotaRows)
                let isHidden = config.hidden;
                if (isHidden === undefined) {
                    isHidden = (family === 'other' || family === 'unknown');
                }
                if (isHidden && !showHidden) return;

                const quotaInfo = [];
                // Use ALL accounts (no account filter)
                this.accounts.forEach(acc => {
                    if (acc.enabled === false) return;
                    const limit = acc.limits?.[modelId];
                    if (!limit) return;
                    const pct = limit.remainingFraction !== null ? Math.round(limit.remainingFraction * 100) : 0;
                    quotaInfo.push({ pct });
                });

                // treat missing quotaInfo as 0%/unknown; still include row
                rows.push({ modelId, family, quotaInfo });
            });

            return rows;
        },

        /**
         * Generate placeholder account and model data for UI testing
         */
        _generatePlaceholderData() {
            const models = [
                'claude-opus-4-6-thinking',
                'claude-sonnet-4-6',
                'gemini-3.8-flash-tiered',
                'gemini-3.6-flash-high',
                'gemini-3.6-flash-low',
                'gemini-3.5-flash-low'
            ];

            const tiers = ['ultra', 'pro', 'pro', 'free'];
            const names = ['alice', 'bob', 'charlie', 'diana'];
            const domains = ['workspace.dev', 'company.io', 'example.org', 'test.net'];

            const accounts = names.map((name, i) => {
                const email = `${name}@${domains[i]}`;
                const tier = tiers[i];

                // Generate varied quota per model per account
                const limits = {};
                models.forEach((modelId, mi) => {
                    // Create a deterministic but varied fraction
                    const seed = ((i * 7 + mi * 13) % 100);
                    const fraction = seed < 10 ? 0 : seed / 100;
                    const resetTime = fraction === 0
                        ? new Date(Date.now() + (30 + i * 15) * 60000).toISOString()
                        : null;
                    limits[modelId] = {
                        remaining: Math.round(fraction * 100) + '%',
                        remainingFraction: fraction,
                        resetTime
                    };
                });

                return {
                    email,
                    status: i === 3 ? 'invalid' : 'ok',
                    error: i === 3 ? 'Token expired' : null,
                    source: i === 0 ? 'database' : 'oauth',
                    enabled: i !== 2 ? true : false,
                    projectId: `proj-${name}-${1000 + i}`,
                    isInvalid: i === 3,
                    invalidReason: i === 3 ? 'Token expired' : null,
                    lastUsed: new Date(Date.now() - i * 3600000).toISOString(),
                    modelRateLimits: {},
                    quotaThreshold: i === 1 ? 0.15 : undefined,
                    modelQuotaThresholds: i === 0 ? { 'claude-opus-4-6-thinking': 0.25 } : {},
                    subscription: { tier, projectId: `proj-${name}-${1000 + i}`, detectedAt: Date.now() },
                    limits
                };
            });

            return { accounts, models };
        },

        /**
         * Enable or disable placeholder data injection
         */
        setPlaceholderMode(enabled, includeReal) {
            this.placeholderMode = enabled;
            this.placeholderIncludeReal = includeReal;

            // Persist to settings store
            const settings = Alpine.store('settings');
            if (settings) {
                settings.placeholderMode = enabled;
                settings.placeholderIncludeReal = includeReal;
                settings.saveSettings(true);
            }

            if (enabled) {
                // Stash real data
                this._realAccounts = [...this.accounts];
                this._realModels = [...this.models];

                const { accounts: fakeAccounts, models: fakeModels } = this._generatePlaceholderData();

                if (includeReal && this._realAccounts.length > 0) {
                    // Merge: real accounts first, then placeholders
                    this.accounts = [...this._realAccounts, ...fakeAccounts];
                    // Union of models
                    const modelSet = new Set([...this._realModels, ...fakeModels]);
                    this.models = Array.from(modelSet).sort();
                } else {
                    this.accounts = fakeAccounts;
                    this.models = fakeModels;
                }
            } else {
                // Restore real data
                if (this._realAccounts !== null) {
                    this.accounts = this._realAccounts;
                    this._realAccounts = null;
                }
                if (this._realModels !== null) {
                    this.models = this._realModels;
                    this._realModels = null;
                }
            }

            this.computeQuotaRows();
        }
    });
});
