/**
 * Utility functions for Antigravity Console
 */

window.utils = {
    // Shared Request Wrapper
    async request(url, options = {}, webuiPassword = '') {
        options.headers = options.headers || {};
        if (webuiPassword) {
            options.headers['x-webui-password'] = webuiPassword;
        }

        let response = await fetch(url, options);

        if (response.status === 401) {
            const store = Alpine.store('global');
            const password = prompt(store ? store.t('enterPassword') : 'Enter Web UI Password:');
            if (password) {
                // Return new password so caller can update state
                // This implies we need a way to propagate the new password back
                // For simplicity in this functional utility, we might need a callback or state access
                // But generally utils shouldn't probably depend on global state directly if possible
                // let's stick to the current logic but wrapped
                localStorage.setItem('antigravity_webui_password', password);
                options.headers['x-webui-password'] = password;
                response = await fetch(url, options);
                return { response, newPassword: password };
            }
        }

        return { response, newPassword: null };
    },

    formatTimeUntil(isoTime) {
        if (!isoTime) return '-';
        const store = Alpine.store('global');
        const diff = new Date(isoTime) - new Date();
        if (diff <= 0) return store ? store.t('ready') : 'READY';
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        const days = Math.floor(hrs / 24);
        const remHrs = hrs % 24;

        const dSuffix = store ? (store.t('timeD') || 'd') : 'd';
        const hSuffix = store ? store.t('timeH') : 'H';
        const mSuffix = store ? store.t('timeM') : 'M';

        if (days > 0) return `${days}${dSuffix} ${remHrs}${hSuffix}`;
        if (hrs > 0) return `${hrs}${hSuffix} ${mins % 60}${mSuffix}`;
        return `${mins}${mSuffix}`;
    },

    formatDateTime(isoTime) {
        if (!isoTime) return '';
        const d = new Date(isoTime);
        if (isNaN(d.getTime())) return '';
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${m}-${day} ${h}:${min}`;
    },

    formatResetTooltip(quotaInfo, type = '5h') {
        if (!quotaInfo || quotaInfo.length === 0) return 'No data';
        const is5h = type === '5h';
        const title = is5h ? '【5小时滑动配额重置】' : '【周总额度周期重置】';

        // Helper to pad string accounting for CJK full-width characters (width = 2)
        const pad = (str, width) => {
            const s = String(str ?? '');
            let visualLen = 0;
            for (let i = 0; i < s.length; i++) {
                visualLen += s.charCodeAt(i) > 255 ? 2 : 1;
            }
            return s + ' '.repeat(Math.max(0, width - visualLen));
        };

        const header = is5h
            ? `${pad('账号 (Account)', 18)}${pad('周期', 6)}${pad('5H剩余', 8)}${pad('倒计时', 12)}重置时间`
            : `${pad('账号 (Account)', 18)}${pad('周期', 6)}${pad('周剩余', 8)}${pad('已消耗', 8)}${pad('倒计时', 12)}重置时间`;
        const divider = '─'.repeat(is5h ? 50 : 58);
        const lines = [title, header, divider];

        quotaInfo.forEach(q => {
            const rawEmail = q.email || '';
            const email = rawEmail.length > 15 ? rawEmail.slice(0, 14) + '…' : rawEmail;
            if (is5h) {
                if (!q.resetTime && q.pct === undefined) return;
                const pct = (q.pct !== undefined ? q.pct : 0) + '%';
                const countdown = window.utils.formatTimeUntil(q.resetTime);
                const exact = window.utils.formatDateTime(q.resetTime) || '-';
                lines.push(`${pad(email, 18)}${pad('5H', 6)}${pad(pct, 8)}${pad(countdown, 12)}${exact}`);
            } else {
                if (!q.weeklyResetTime && q.weeklyPct === undefined) return;
                const rem = q.weeklyPct !== null && q.weeklyPct !== undefined ? q.weeklyPct + '%' : '-';
                const used = q.weeklyUsedPct !== null && q.weeklyUsedPct !== undefined ? q.weeklyUsedPct + '%' : '-';
                const countdown = window.utils.formatTimeUntil(q.weeklyResetTime);
                const exact = window.utils.formatDateTime(q.weeklyResetTime) || '-';
                lines.push(`${pad(email, 18)}${pad('W', 6)}${pad(rem, 8)}${pad(used, 8)}${pad(countdown, 12)}${exact}`);
            }
        });

        return lines.join('\n');
    },

    formatQuotaTooltip(row) {
        if (!row || !row.quotaInfo || row.quotaInfo.length === 0) return 'No data';
        const title = `【${row.modelId} 配额全景明细】`;

        const pad = (str, width) => {
            const s = String(str ?? '');
            let visualLen = 0;
            for (let i = 0; i < s.length; i++) {
                visualLen += s.charCodeAt(i) > 255 ? 2 : 1;
            }
            return s + ' '.repeat(Math.max(0, width - visualLen));
        };

        const header = `${pad('账号 (Account)', 18)}${pad('5H剩余', 9)}${pad('周剩余', 9)}${pad('已消耗', 9)}${pad('5H倒计', 11)}周倒计`;
        const divider = '─'.repeat(62);
        const lines = [title, header, divider];

        row.quotaInfo.forEach(q => {
            const rawEmail = q.email || '';
            const email = rawEmail.length > 15 ? rawEmail.slice(0, 14) + '…' : rawEmail;
            const hPct = (q.pct !== undefined ? q.pct : 0) + '%';
            const wPct = q.weeklyPct !== null && q.weeklyPct !== undefined ? q.weeklyPct + '%' : '-';
            const wUsed = q.weeklyUsedPct !== null && q.weeklyUsedPct !== undefined ? q.weeklyUsedPct + '%' : '-';
            const hReset = window.utils.formatTimeUntil(q.resetTime);
            const wReset = window.utils.formatTimeUntil(q.weeklyResetTime) || '-';
            lines.push(`${pad(email, 18)}${pad(hPct, 9)}${pad(wPct, 9)}${pad(wUsed, 9)}${pad(hReset, 11)}${wReset}`);
        });

        return lines.join('\n');
    },

    getThemeColor(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },

    /**
     * Debounce function - delays execution until after specified wait time
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};
