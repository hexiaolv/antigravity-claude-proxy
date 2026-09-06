import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from '../config.js';

/**
 * Shared Utility Functions
 *
 * General-purpose helper functions used across multiple modules.
 */

/**
 * Get the package version from package.json
 * @param {string} [defaultVersion='1.0.0'] - Default version if package.json cannot be read
 * @returns {string} The package version
 */
export function getPackageVersion(defaultVersion = '1.0.0') {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const packageJsonPath = path.join(__dirname, '../../package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version || defaultVersion;
    } catch {
        return defaultVersion;
    }
}

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration (e.g., "1h23m45s")
 */
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h${minutes}m${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m${secs}s`;
    }
    return `${secs}s`;
}


/**
 * Sleep for specified milliseconds
 * @param {number} ms - Duration to sleep in milliseconds
 * @returns {Promise<void>} Resolves after the specified duration
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a network error (transient)
 * @param {Error} error - The error to check
 * @returns {boolean} True if it is a network error
 */
export function isNetworkError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    const name = (error.name || '').toLowerCase();
    const code = (error.code || '').toLowerCase();
    return (
        msg.includes('fetch failed') ||
        msg.includes('network error') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('socket hang up') ||
        msg.includes('timeout') ||
        msg.includes('timed out') ||
        msg.includes('abort') ||
        msg.includes('econnrefused') ||
        name === 'aborterror' ||
        name === 'timeouterror' ||
        code === 'und_err_connect_timeout' ||
        code === 'und_err_headers_timeout' ||
        code === 'und_err_body_timeout' ||
        code === 'econnreset' ||
        code === 'etimedout'
    );
}

/**
 * Throttled fetch that applies a configurable delay and optional timeout
 * Only applies delay when requestThrottlingEnabled is true
 * @param {string|URL} url - The URL to fetch
 * @param {RequestInit} [options={}] - Fetch options
 * @param {number|null} [timeoutMs=null] - Optional timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 */
export async function throttledFetch(url, options = {}, timeoutMs = null) {
    if (config.requestThrottlingEnabled) {
        const delayMs = config.requestDelayMs || 200;
        if (delayMs > 0) {
            await sleep(delayMs);
        }
    }

    const timeout = timeoutMs ?? options?.timeoutMs ?? options?.timeout;
    if (!timeout || timeout <= 0) {
        return fetch(url, options);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeout}ms: ${url}`));
    }, timeout);

    let onExternalAbort = null;
    if (options.signal) {
        if (options.signal.aborted) {
            clearTimeout(timeoutId);
            controller.abort(options.signal.reason);
        } else {
            onExternalAbort = () => {
                clearTimeout(timeoutId);
                controller.abort(options.signal.reason);
            };
            options.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
    }

    try {
        const fetchOptions = { ...options, signal: controller.signal };
        delete fetchOptions.timeout;
        delete fetchOptions.timeoutMs;
        return await fetch(url, fetchOptions);
    } finally {
        clearTimeout(timeoutId);
        if (options.signal && onExternalAbort) {
            options.signal.removeEventListener('abort', onExternalAbort);
        }
    }
}

/**
 * Fetch with an enforced timeout (default 10s)
 * @param {string|URL} url - The URL to fetch
 * @param {RequestInit} [options={}] - Fetch options
 * @param {number} [timeoutMs=10000] - Timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    return throttledFetch(url, options, timeoutMs);
}

/**
 * Generate random jitter for backoff timing (Thundering Herd Prevention)
 * Prevents all clients from retrying at the exact same moment after errors.
 * @param {number} maxJitterMs - Maximum jitter range (result will be ±maxJitterMs/2)
 * @returns {number} Random jitter value between -maxJitterMs/2 and +maxJitterMs/2
 */
export function generateJitter(maxJitterMs) {
    return Math.random() * maxJitterMs - (maxJitterMs / 2);
}
