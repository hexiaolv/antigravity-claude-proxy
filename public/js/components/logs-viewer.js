/**
 * Logs Viewer Component
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

let _logIdCounter = 0;

window.Components.logsViewer = () => ({
    logs: [],
    isAutoScroll: true,
    eventSource: null,
    searchQuery: '',
    filters: {
        INFO: true,
        WARN: true,
        ERROR: true,
        SUCCESS: true,
        DEBUG: false
    },
    _incomingBuffer: [],
    _flushTimer: null,
    _visibilityHandler: null,

    get filteredLogs() {
        const query = this.searchQuery.trim();
        if (!query) {
            return this.logs.filter(log => this.filters[log.level]);
        }

        // Try regex first, fallback to plain text search
        let matcher;
        try {
            const regex = new RegExp(query, 'i');
            matcher = (msg) => regex.test(msg);
        } catch (e) {
            // Invalid regex, fallback to case-insensitive string search
            const lowerQuery = query.toLowerCase();
            matcher = (msg) => msg.toLowerCase().includes(lowerQuery);
        }

        return this.logs.filter(log => {
            // Level Filter
            if (!this.filters[log.level]) return false;

            // Search Filter
            return matcher(log.message);
        });
    },

    init() {
        // Only start stream if logs tab is active on initial load
        if (Alpine.store('global')?.activeTab === 'logs' && !document.hidden) {
            this.startLogStream();
        }

        // Start/stop stream on tab change (prevents background SSE and DOM churn)
        this.$watch('$store.global.activeTab', (val) => {
            if (val === 'logs' && !document.hidden) {
                this.startLogStream();
                if (this.isAutoScroll) {
                    this.$nextTick(() => this.scrollToBottom());
                }
            } else {
                this.stopLogStream();
            }
        });

        // Pause stream when tab hidden/system sleep, resume cleanly on wake
        this._visibilityHandler = () => {
            if (document.hidden) {
                this.stopLogStream();
            } else if (Alpine.store('global')?.activeTab === 'logs') {
                this.startLogStream();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Sync DEBUG filter with debugLogging sub-toggle
        const settings = Alpine.store('settings');
        if (settings) {
            this.filters.DEBUG = !!settings.debugLogging;
            this.$watch('$store.settings.debugLogging', (val) => {
                this.filters.DEBUG = !!val;
            });
        }

        this.$watch('isAutoScroll', (val) => {
            if (val) this.scrollToBottom();
        });

        // Watch filters to maintain auto-scroll if enabled
        this.$watch('searchQuery', () => { if(this.isAutoScroll) this.$nextTick(() => this.scrollToBottom()) });
        this.$watch('filters', () => { if(this.isAutoScroll) this.$nextTick(() => this.scrollToBottom()) });
    },

    reconnectTimer: null,

    _flushLogs() {
        this._flushTimer = null;
        if (this._incomingBuffer.length === 0) return;

        const toAdd = this._incomingBuffer;
        this._incomingBuffer = [];

        this.logs.push(...toAdd);

        // Limit log buffer
        const limit = Alpine.store('settings')?.logLimit || window.AppConstants.LIMITS.DEFAULT_LOG_LIMIT;
        if (this.logs.length > limit) {
            this.logs = this.logs.slice(-limit);
        }

        if (this.isAutoScroll) {
            this.$nextTick(() => this.scrollToBottom());
        }
    },

    stopLogStream() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }

        // Flush any remaining buffered logs before closing
        if (this._incomingBuffer.length > 0) {
            this._flushLogs();
        }

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    },

    startLogStream() {
        // Guard: only stream when logs tab is active and page is visible
        if (Alpine.store('global')?.activeTab !== 'logs' || document.hidden) {
            return;
        }

        this.stopLogStream();

        const password = Alpine.store('global').webuiPassword;
        const url = password
            ? `/api/logs/stream?history=true&password=${encodeURIComponent(password)}`
            : '/api/logs/stream?history=true';

        this.eventSource = new EventSource(url);
        this.eventSource.onmessage = (event) => {
            try {
                const log = JSON.parse(event.data);
                log._id = ++_logIdCounter;
                this._incomingBuffer.push(log);

                // Batch buffer flush (50ms throttle) to eliminate per-log DOM thrashing
                if (!this._flushTimer) {
                    this._flushTimer = setTimeout(() => this._flushLogs(), 50);
                }
            } catch (e) {
                if (window.UILogger) window.UILogger.debug('Log parse error:', e.message);
            }
        };

        this.eventSource.onerror = () => {
            if (window.UILogger) window.UILogger.debug('Log stream disconnected, reconnecting...');
            this.stopLogStream();

            if (!this.reconnectTimer) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    if (!document.hidden && Alpine.store('global')?.activeTab === 'logs') {
                        this.startLogStream();
                    }
                }, 3000);
            }
        };
    },

    scrollToBottom() {
        const container = document.getElementById('logs-container');
        if (container) container.scrollTop = container.scrollHeight;
    },

    clearLogs() {
        this._incomingBuffer = [];
        this.logs = [];
    },

    exportLogs() {
        if (this.logs.length === 0) return;

        const shouldRedact = Alpine.store('settings')?.redactMode && window.Redact;
        const lines = this.logs.map(log => {
            const ts = new Date(log.timestamp).toISOString();
            const message = shouldRedact ? window.Redact.logMessage(log.message) : log.message;
            return `[${ts}] [${log.level}] ${message}`;
        });

        const text = lines.join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proxy-logs-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});
