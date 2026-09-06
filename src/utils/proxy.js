/**
 * HTTP Proxy Support
 * 
 * Configures global fetch to use HTTP proxy from environment variables.
 * Supports: http_proxy, HTTP_PROXY, https_proxy, HTTPS_PROXY
 * 
 * This module should be imported at the very beginning of the application
 * entry point (src/index.js) before any fetch calls are made.
 */

import { ProxyAgent, Agent, setGlobalDispatcher } from 'undici';
import { logger } from './logger.js';

/**
 * Initialize proxy support from environment variables
 * Call this once at application startup
 */
export function initProxy() {
    const proxyUrl = process.env.http_proxy ||
        process.env.HTTP_PROXY ||
        process.env.https_proxy ||
        process.env.HTTPS_PROXY;

    if (!proxyUrl) {
        try {
            // Configure default dispatcher with reasonable timeouts so zombie connections
            // following system sleep/wake are cleanly reconnected
            const defaultAgent = new Agent({
                connect: {
                    timeout: 10000
                },
                keepAliveTimeout: 10000,
                keepAliveMaxTimeout: 30000
            });
            setGlobalDispatcher(defaultAgent);
        } catch (error) {
            logger.debug(`[Dispatcher] Default dispatcher initialization: ${error.message}`);
        }
        return;
    }

    try {
        const proxyAgent = new ProxyAgent({
            uri: proxyUrl,
            connect: {
                timeout: 10000
            },
            keepAliveTimeout: 10000,
            keepAliveMaxTimeout: 30000
        });
        setGlobalDispatcher(proxyAgent);
        logger.info(`[Proxy] Using proxy: ${proxyUrl}`);
    } catch (error) {
        logger.error(`[Proxy] Failed to configure proxy: ${error.message}`);
    }
}

// Auto-initialize on import
initProxy();
