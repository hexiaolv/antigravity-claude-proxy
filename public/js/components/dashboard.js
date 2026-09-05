/**
 * Dashboard Component (Refactored)
 * Orchestrates stats, charts, and filters modules
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.dashboard = () => ({
    // Core state
    stats: { total: 0, active: 0, limited: 0, overallHealth: 0, hasTrendData: false },
    hasFilteredTrendData: true,
    charts: { quotaDistribution: null, usageTrend: null, quotaCycle: null },
    usageStats: { total: 0, today: 0, thisHour: 0 },
    quotaCycle: [],
    quotaSummaryAccounts: [],
    selectedQuotaEmail: '',
    currentQuotaSummary: null,
    historyData: {},
    modelTree: {},
    families: [],

    // Claude config status
    claudeConfigStatus: {
        needsApply: false,
        presetName: '',
        checked: false,
        lastCheckedAt: 0
    },

    // Filter state (from module)
    ...window.DashboardFilters.getInitialState(),

    // Debounced chart update to prevent rapid successive updates
    _debouncedUpdateTrendChart: null,
    _debouncedUpdateQuotaCycle: null,

    init() {
        // Create debounced version of updateTrendChart (300ms delay for stability)
        this._debouncedUpdateTrendChart = window.utils.debounce(() => {
            window.DashboardCharts.updateTrendChart(this);
        }, 300);

        this._debouncedUpdateQuotaCycle = window.utils.debounce(() => {
            window.DashboardCharts.updateQuotaCycleChart(this);
        }, 100);

        // Load saved preferences from localStorage
        window.DashboardFilters.loadPreferences(this);

        // Check Claude config status on init
        this.checkClaudeConfigStatus();

        // Update stats when dashboard becomes active (skip initial trigger)
        this.$watch('$store.global.activeTab', (val, oldVal) => {
            if (val === 'dashboard' && oldVal !== undefined) {
                this.$nextTick(() => {
                    this.updateStats();
                    this.updateCharts();
                    this.updateTrendChart();
                    this.updateQuotaCycle();
                    this.checkClaudeConfigStatus();
                });
            }
        });

        // Watch for data changes
        this.$watch('$store.data.accounts', () => {
            if (this.$store.global.activeTab === 'dashboard') {
                this.updateStats();
                this.updateQuotaCycle();
                // Debounce chart updates to prevent rapid flickering
                if (this._debouncedUpdateCharts) {
                    this._debouncedUpdateCharts();
                } else {
                    this._debouncedUpdateCharts = window.utils.debounce(() => this.updateCharts(), 100);
                    this._debouncedUpdateCharts();
                }
            }
        });

        // Watch for history updates from data-store (automatically loaded with account data)
        this.$watch('$store.data.usageHistory', (newHistory) => {
            if (this.$store.global.activeTab === 'dashboard' && newHistory && Object.keys(newHistory).length > 0) {
                // Optimization: Skip if data hasn't changed (prevents double render on load)
                if (this.historyData && JSON.stringify(newHistory) === JSON.stringify(this.historyData)) {
                    return;
                }

                this.historyData = newHistory;
                this.processHistory(newHistory);
                this.stats.hasTrendData = true;
            }
        });

        // Initial update if already on dashboard
        // Note: Alpine.store('data') may already have data from cache if initialized before this component
        if (this.$store.global.activeTab === 'dashboard') {
            this.$nextTick(() => {
                this.updateStats();
                this.updateCharts();
                this.updateQuotaCycle();

                // Optimization: Only process history if it hasn't been processed yet
                // The usageHistory watcher above will handle updates if data changes
                const history = Alpine.store('data').usageHistory;
                if (history && Object.keys(history).length > 0) {
                    // Check if we already have this data to avoid redundant chart update
                    if (!this.historyData || JSON.stringify(history) !== JSON.stringify(this.historyData)) {
                        this.historyData = history;
                        this.processHistory(history);
                        this.stats.hasTrendData = true;
                    }
                }
            });
        }
    },

    processHistory(history) {
        // Build model tree from hierarchical data
        const tree = {};
        let total = 0, today = 0, thisHour = 0;

        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const currentHour = new Date(now);
        currentHour.setMinutes(0, 0, 0);

        Object.entries(history).forEach(([iso, hourData]) => {
            const timestamp = new Date(iso);

            // Process each family in the hour data
            Object.entries(hourData).forEach(([key, value]) => {
                // Skip metadata keys
                if (key === '_total' || key === 'total') return;

                // Handle hierarchical format: { claude: { "opus-4-5": 10, "_subtotal": 10 } }
                if (typeof value === 'object' && value !== null) {
                    if (!tree[key]) tree[key] = new Set();

                    Object.keys(value).forEach(modelName => {
                        if (modelName !== '_subtotal') {
                            tree[key].add(modelName);
                        }
                    });
                }
            });

            // Calculate totals
            const hourTotal = hourData._total || hourData.total || 0;
            total += hourTotal;

            if (timestamp >= todayStart) {
                today += hourTotal;
            }
            if (timestamp.getTime() === currentHour.getTime()) {
                thisHour = hourTotal;
            }
        });

        this.usageStats = { total, today, thisHour };

        // Convert Sets to sorted arrays
        this.modelTree = {};
        Object.entries(tree).forEach(([family, models]) => {
            this.modelTree[family] = Array.from(models).sort();
        });
        this.families = Object.keys(this.modelTree).sort();

        // Auto-select new families/models that haven't been configured
        this.autoSelectNew();

        this.updateTrendChart();
    },

    processQuotaCycle() {
        const accounts = Alpine.store('data')?.accounts || [];
        const summaryAccounts = [];

        accounts.forEach(acc => {
            if (acc.enabled === false) return;

            const email = acc.email || '';
            const label = email.split('@')[0] || email;
            const tier = acc.subscription?.tier || 'unknown';

            let groups = [];

            // Check if real quotaSummary from retrieveUserQuotaSummary is present
            if (acc.quotaSummary && Array.isArray(acc.quotaSummary.groups) && acc.quotaSummary.groups.length > 0) {
                groups = acc.quotaSummary.groups.map(g => {
                    const buckets = (g.buckets || []).map(b => {
                        const remainingFraction = b.remainingFraction ?? 0;
                        const pct = Math.round(remainingFraction * 100);
                        return {
                            bucketId: b.bucketId || '',
                            displayName: b.displayName || '',
                            window: b.window || (b.bucketId?.includes('weekly') ? 'weekly' : '5h'),
                            remainingFraction,
                            pct,
                            resetTime: b.resetTime || null,
                            description: b.description || ''
                        };
                    });
                    const fiveHourBucket = buckets.find(b => b.window === '5h' || b.bucketId.includes('5h')) || null;
                    const weeklyBucket = buckets.find(b => b.window === 'weekly' || b.bucketId.includes('weekly')) || null;
                    const healthPct = Math.min(fiveHourBucket?.pct ?? 100, weeklyBucket?.pct ?? 100);
                    const isGemini = (g.displayName || '').toLowerCase().includes('gemini');
                    const isClaude = (g.displayName || '').toLowerCase().includes('claude') || (g.displayName || '').toLowerCase().includes('gpt');

                    return {
                        displayName: g.displayName || '',
                        description: g.description || '',
                        buckets,
                        fiveHourBucket,
                        weeklyBucket,
                        healthPct,
                        isGemini,
                        isClaude,
                        iconLetter: isGemini ? 'G' : (isClaude ? 'C' : 'M'),
                        subModels: isGemini ? 'Flash / Pro' : (isClaude ? 'Opus / Sonnet / OSS' : '')
                    };
                });
            } else {
                // Synthesize groups from model limits if retrieveUserQuotaSummary is unavailable
                const geminiLimits = [];
                const claudeLimits = [];
                let geminiReset = null;
                let claudeReset = null;

                Object.entries(acc.limits || {}).forEach(([modelId, limit]) => {
                    if (!limit || limit.remainingFraction === null || limit.remainingFraction === undefined) return;
                    const isClaude = modelId.includes('claude') || modelId.includes('gpt');
                    if (isClaude) {
                        claudeLimits.push(limit.remainingFraction);
                        if (limit.resetTime && (!claudeReset || new Date(limit.resetTime) < new Date(claudeReset))) {
                            claudeReset = limit.resetTime;
                        }
                    } else if (modelId.includes('gemini')) {
                        geminiLimits.push(limit.remainingFraction);
                        if (limit.resetTime && (!geminiReset || new Date(limit.resetTime) < new Date(geminiReset))) {
                            geminiReset = limit.resetTime;
                        }
                    }
                });

                const geminiAvg = geminiLimits.length > 0
                    ? geminiLimits.reduce((a, b) => a + b, 0) / geminiLimits.length
                    : 1.0;
                const claudeAvg = claudeLimits.length > 0
                    ? claudeLimits.reduce((a, b) => a + b, 0) / claudeLimits.length
                    : 1.0;

                const gemini5h = {
                    bucketId: 'gemini-5h',
                    displayName: 'Five Hour Limit Remaining',
                    window: '5h',
                    remainingFraction: geminiAvg,
                    pct: Math.round(geminiAvg * 100),
                    resetTime: geminiReset,
                    description: ''
                };
                const geminiWeekly = {
                    bucketId: 'gemini-weekly',
                    displayName: 'Weekly Limit Remaining',
                    window: 'weekly',
                    remainingFraction: geminiAvg,
                    pct: Math.round(geminiAvg * 100),
                    resetTime: null,
                    description: ''
                };

                const claude5h = {
                    bucketId: '3p-5h',
                    displayName: 'Five Hour Limit Remaining',
                    window: '5h',
                    remainingFraction: claudeAvg,
                    pct: Math.round(claudeAvg * 100),
                    resetTime: claudeReset,
                    description: ''
                };
                const claudeWeekly = {
                    bucketId: '3p-weekly',
                    displayName: 'Weekly Limit Remaining',
                    window: 'weekly',
                    remainingFraction: claudeAvg,
                    pct: Math.round(claudeAvg * 100),
                    resetTime: null,
                    description: ''
                };

                groups = [
                    {
                        displayName: 'Gemini Models',
                        description: 'Models within this group: Gemini Flash, Gemini Pro',
                        buckets: [geminiWeekly, gemini5h],
                        fiveHourBucket: gemini5h,
                        weeklyBucket: geminiWeekly,
                        healthPct: Math.round(geminiAvg * 100),
                        isGemini: true,
                        isClaude: false,
                        iconLetter: 'G',
                        subModels: 'Flash / Pro'
                    },
                    {
                        displayName: 'Claude and GPT models',
                        description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
                        buckets: [claudeWeekly, claude5h],
                        fiveHourBucket: claude5h,
                        weeklyBucket: claudeWeekly,
                        healthPct: Math.round(claudeAvg * 100),
                        isGemini: false,
                        isClaude: true,
                        iconLetter: 'C',
                        subModels: 'Opus / Sonnet / OSS'
                    }
                ];
            }

            summaryAccounts.push({
                email,
                label,
                tier,
                groups
            });
        });

        this.quotaSummaryAccounts = summaryAccounts;

        // Maintain selection
        if (!this.selectedQuotaEmail || !summaryAccounts.some(a => a.email === this.selectedQuotaEmail)) {
            this.selectedQuotaEmail = summaryAccounts[0]?.email || '';
        }

        this.currentQuotaSummary = summaryAccounts.find(a => a.email === this.selectedQuotaEmail) || null;
        return summaryAccounts;
    },

    selectQuotaEmail(email) {
        this.selectedQuotaEmail = email;
        this.currentQuotaSummary = this.quotaSummaryAccounts.find(a => a.email === email) || null;
    },

    getQuotaRingColor(pct) {
        if (pct >= 60) return '#10b981'; // emerald-500
        if (pct >= 25) return '#f59e0b'; // amber-500
        return '#ef4444'; // rose-500
    },

    getGroupDisplayName(group) {
        if (!group) return '';
        const store = Alpine.store('global');
        const name = group.displayName || '';
        if (name.toLowerCase().includes('gemini')) return store ? store.t('geminiModels') : name;
        if (name.toLowerCase().includes('claude') || name.toLowerCase().includes('gpt')) return store ? store.t('claudeGptModels') : name;
        return name;
    },

    getGroupDescription(group) {
        if (!group) return '';
        const store = Alpine.store('global');
        const name = group.displayName || '';
        if (name.toLowerCase().includes('gemini')) return store ? store.t('geminiModelsDesc') : (group.description || '');
        if (name.toLowerCase().includes('claude') || name.toLowerCase().includes('gpt')) return store ? store.t('claudeGptModelsDesc') : (group.description || '');
        return group.description || '';
    },

    getBucketDisplayName(bucket) {
        if (!bucket) return '';
        const store = Alpine.store('global');
        const name = bucket.displayName || '';
        const window = bucket.window || '';
        if (window === 'weekly' || name.toLowerCase().includes('weekly')) return store ? store.t('weeklyLimitRemaining') : name;
        if (window === '5h' || name.toLowerCase().includes('five hour')) return store ? store.t('fiveHourLimitRemaining') : name;
        return name;
    },

    formatQuotaDescription(bucket) {
        if (!bucket) return '';
        const store = Alpine.store('global');
        const lang = store?.lang || 'en';
        const isZh = lang === 'zh';
        const pct = bucket.pct ?? 100;
        const isWeekly = bucket.window === 'weekly' || (bucket.bucketId && bucket.bucketId.includes('weekly'));

        let timeStr = '';
        if (bucket.resetTime) {
            const diff = new Date(bucket.resetTime) - new Date();
            if (diff <= 0) {
                return isZh ? '额度已完全重置就绪。' : 'Quota has fully refreshed and is ready to use.';
            }
            const mins = Math.floor(diff / 60000);
            const hours = Math.floor(mins / 60);
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            const remMins = mins % 60;

            if (isZh) {
                if (days > 0) timeStr = `${days} 天 ${remHours} 小时`;
                else if (hours > 0) timeStr = `${hours} 小时 ${remMins} 分钟`;
                else timeStr = `${remMins} 分钟`;
            } else {
                if (days > 0) timeStr = `${days} day${days > 1 ? 's' : ''}, ${remHours} hour${remHours > 1 ? 's' : ''}`;
                else if (hours > 0) timeStr = `${hours} hour${hours > 1 ? 's' : ''}, ${remMins} minute${remMins > 1 ? 's' : ''}`;
                else timeStr = `${remMins} minute${remMins > 1 ? 's' : ''}`;
            }
        }

        if (isZh) {
            const limitName = isWeekly ? '周配额' : '5 小时配额';
            if (pct >= 100) return `未消耗${limitName}，额度充足。`;
            if (pct <= 0) return `${limitName}已耗尽${timeStr ? `，将在 ${timeStr} 后完全重置` : ''}。`;
            return `您已消耗部分${limitName}${timeStr ? `，将在 ${timeStr} 后完全重置` : ''}。`;
        }

        // English / default
        if (bucket.description && pct < 100 && pct > 0) {
            return bucket.description;
        }
        const limitName = isWeekly ? 'weekly limit' : '5-hour limit';
        if (pct >= 100) return `You have not used any of your ${limitName}.`;
        if (pct <= 0) return `You have hit your ${limitName}${timeStr ? `, it will fully refresh in ${timeStr}` : ''}.`;
        return `You have used some of your ${limitName}${timeStr ? `, it will fully refresh in ${timeStr}` : ''}.`;
    },

    formatResetCountdownOnly(resetTime) {
        if (!resetTime) return '';
        const store = Alpine.store('global');
        const lang = store?.lang || 'en';
        const isZh = lang === 'zh';
        const diff = new Date(resetTime) - new Date();
        if (diff <= 0) {
            return isZh ? '已完全重置就绪' : 'Fully refreshed';
        }
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        const remMins = mins % 60;

        let timeStr = '';
        if (isZh) {
            if (days > 0) timeStr = `${days} 天 ${remHours} 小时`;
            else if (hours > 0) timeStr = `${hours} 小时 ${remMins} 分钟`;
            else timeStr = `${remMins} 分钟`;
            return `${timeStr}后完全重置`;
        } else {
            if (days > 0) timeStr = `${days} day${days > 1 ? 's' : ''}, ${remHours} hour${remHours > 1 ? 's' : ''}`;
            else if (hours > 0) timeStr = `${hours} hour${hours > 1 ? 's' : ''}, ${remMins} minute${remMins > 1 ? 's' : ''}`;
            else timeStr = `${remMins} minute${remMins > 1 ? 's' : ''}`;
            return `Fully refreshes in ${timeStr}`;
        }
    },

    getGroupHealthLabel(group) {
        if (!group) return '';
        const store = Alpine.store('global');
        const isZh = store?.lang === 'zh';
        const pct = group.healthPct ?? 100;
        if (pct >= 80) return isZh ? `健康 ${pct}%` : `Healthy ${pct}%`;
        if (pct >= 50) return isZh ? `充裕 ${pct}%` : `Good ${pct}%`;
        if (pct >= 20) return isZh ? `中度使用 ${pct}%` : `Moderate ${pct}%`;
        if (pct > 0) return isZh ? `吃紧 ${pct}%` : `Low ${pct}%`;
        return isZh ? '已耗尽 0%' : 'Depleted 0%';
    },

    getProgressBarColor(pct) {
        if (pct >= 60) return 'bg-neon-green';
        if (pct >= 25) return 'bg-amber-400';
        return 'bg-neon-red';
    },

    getProgressTextColor(pct) {
        if (pct >= 60) return 'text-neon-green';
        if (pct >= 25) return 'text-amber-400';
        return 'text-neon-red';
    },

    // Delegation methods for stats
    updateStats() {
        window.DashboardStats.updateStats(this);
    },

    // Delegation methods for charts
    updateCharts() {
        window.DashboardCharts.updateCharts(this);
    },

    updateQuotaCycle() {
        this.processQuotaCycle();
        if (this._debouncedUpdateQuotaCycle) {
            this._debouncedUpdateQuotaCycle();
        } else if (window.DashboardCharts && window.DashboardCharts.updateQuotaCycleChart) {
            window.DashboardCharts.updateQuotaCycleChart(this);
        }
    },

    updateTrendChart() {
        // Use debounced version to prevent rapid successive updates
        if (this._debouncedUpdateTrendChart) {
            this._debouncedUpdateTrendChart();
        } else {
            // Fallback if debounced version not initialized
            window.DashboardCharts.updateTrendChart(this);
        }
    },

    // Delegation methods for filters
    loadPreferences() {
        window.DashboardFilters.loadPreferences(this);
    },

    savePreferences() {
        window.DashboardFilters.savePreferences(this);
    },

    setDisplayMode(mode) {
        window.DashboardFilters.setDisplayMode(this, mode);
    },

    setTimeRange(range) {
        window.DashboardFilters.setTimeRange(this, range);
    },

    getTimeRangeLabel() {
        return window.DashboardFilters.getTimeRangeLabel(this);
    },

    toggleFamily(family) {
        window.DashboardFilters.toggleFamily(this, family);
    },

    toggleModel(family, model) {
        window.DashboardFilters.toggleModel(this, family, model);
    },

    isFamilySelected(family) {
        return window.DashboardFilters.isFamilySelected(this, family);
    },

    isModelSelected(family, model) {
        return window.DashboardFilters.isModelSelected(this, family, model);
    },

    selectAll() {
        window.DashboardFilters.selectAll(this);
    },

    deselectAll() {
        window.DashboardFilters.deselectAll(this);
    },

    getFamilyColor(family) {
        return window.DashboardFilters.getFamilyColor(family);
    },

    getModelColor(family, modelIndex) {
        return window.DashboardFilters.getModelColor(family, modelIndex);
    },

    getSelectedCount() {
        return window.DashboardFilters.getSelectedCount(this);
    },

    autoSelectNew() {
        window.DashboardFilters.autoSelectNew(this);
    },

    autoSelectTopN(n = 5) {
        window.DashboardFilters.autoSelectTopN(this, n);
    },

    /**
     * Check if Claude CLI config needs to be updated.
     * Fetches both local config and presets, then compares against all presets.
     * Skips if already checked within the last 30 seconds.
     */
    async checkClaudeConfigStatus() {
        const now = Date.now();
        if (this.claudeConfigStatus.checked && now - this.claudeConfigStatus.lastCheckedAt < 30000) return;

        try {
            const password = Alpine.store('global').webuiPassword;

            const [configRes, presetsRes] = await Promise.all([
                window.utils.request('/api/claude/config', {}, password),
                window.utils.request('/api/claude/presets', {}, password)
            ]);

            if (!configRes.response.ok || !presetsRes.response.ok) {
                this.claudeConfigStatus.checked = true;
                this.claudeConfigStatus.lastCheckedAt = now;
                return;
            }

            const configData = await configRes.response.json();
            const presetsData = await presetsRes.response.json();

            const localConfig = configData.config || { env: {} };
            const presets = presetsData.presets || [];

            if (presets.length === 0) {
                this.claudeConfigStatus = { needsApply: false, presetName: '', checked: true, lastCheckedAt: now };
                return;
            }

            const relevantKeys = [
                'ANTHROPIC_BASE_URL',
                'ANTHROPIC_AUTH_TOKEN',
                'ANTHROPIC_MODEL',
                'CLAUDE_CODE_SUBAGENT_MODEL',
                'ANTHROPIC_DEFAULT_OPUS_MODEL',
                'ANTHROPIC_DEFAULT_SONNET_MODEL',
                'ANTHROPIC_DEFAULT_HAIKU_MODEL',
                'ENABLE_EXPERIMENTAL_MCP_CLI'
            ];

            // Check if local config matches ANY preset
            const matchesAnyPreset = presets.some(preset => {
                return relevantKeys.every(key => {
                    const localVal = localConfig.env?.[key] || '';
                    const presetVal = preset.config?.[key] || '';
                    return localVal === presetVal;
                });
            });

            this.claudeConfigStatus = {
                needsApply: !matchesAnyPreset,
                presetName: presets[0].name,
                checked: true,
                lastCheckedAt: now
            };
        } catch (e) {
            console.error('Failed to check Claude config status:', e);
            this.claudeConfigStatus.checked = true;
            this.claudeConfigStatus.lastCheckedAt = Date.now();
        }
    },

    /**
     * Navigate to Claude CLI settings and dismiss the warning
     */
    goToClaudeSettings() {
        this.$store.global.activeTab = 'settings';
        this.$store.global.settingsTab = 'claude';
    }
});
