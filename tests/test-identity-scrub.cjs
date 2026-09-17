/**
 * Test Caller-Identity Scrubbing - Unit Tests
 *
 * cloudcode-pa answers an opaque 429 RESOURCE_EXHAUSTED, quota notwithstanding,
 * when the system prompt carries a third-party AI product's marker. Claude Code
 * Desktop sends its Anthropic billing header as a system part; against the live
 * API that header name alone reproduced the 429, and renaming it returned 200.
 *
 * Runs offline - no server, accounts or network needed.
 */
const assert = require('assert');

// Set before the dynamic import: rules are compiled once at module load.
process.env.ANTIGRAVITY_SCRUB_IDENTITY = 'Acme Corp=>the team';

// Verbatim from the captured request that reproduced the 429.
const BILLING_LINE = 'x-anthropic-billing-header: cc_version=2.1.271.4bf; cc_entrypoint=claude-desktop-3p;';
const CLAUDE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.";

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}\n  ${e.message}`);
        failed++;
    }
}

async function runTests() {
    const { buildCloudCodeRequest } = await import('../src/cloudcode/request-builder.js');

    /** The system text actually sent upstream, for a given Anthropic `system`. */
    const sentSystem = (system) => buildCloudCodeRequest(
        { model: 'gemini-3.8-flash-low', max_tokens: 64, system, messages: [{ role: 'user', content: 'hi' }] },
        'test-project', 'tester@example.com'
    ).request.systemInstruction.parts.map(p => p.text).join('\n');

    test('the billing header is renamed, its values and neighbours kept', () => {
        const text = sentSystem(`Some preamble.\n${BILLING_LINE}\nMore text.`);
        assert.ok(!text.includes('x-anthropic-billing-header'), 'trigger name must not reach the upstream');
        assert.ok(text.includes('x-client-billing-header'), 'renamed, not dropped');
        assert.ok(text.includes('cc_version=2.1.271.4bf') && text.includes('cc_entrypoint=claude-desktop-3p'), 'values kept');
        assert.ok(text.includes('Some preamble.') && text.includes('More text.'), 'neighbouring text untouched');
    });

    test('the rename is case-insensitive', () => {
        const text = sentSystem('X-Anthropic-Billing-Header: cc_version=1');
        assert.ok(!/x-anthropic-billing-header/i.test(text), 'header names are case-insensitive over the wire');
    });

    test('nothing else in the prompt is rewritten', () => {
        const text = sentSystem([{ type: 'text', text: `${CLAUDE_IDENTITY}\n\nSome instructions.` }]);
        assert.ok(text.includes(CLAUDE_IDENTITY), 'harmless identity prose must pass through (verified 200 live)');
        assert.ok(text.includes('You are Antigravity') && text.includes('[/ignore]'), 'injected Antigravity parts intact');
        assert.ok(!text.includes('x-client-billing-header'), 'no rename without the header');
    });

    test('default vendor rules hold, and the env var extends them', () => {
        const text = sentSystem([{ type: 'text', text: `You are Hermes Agent, created by Nous Research. Built by Acme Corp. ${BILLING_LINE}` }]);
        assert.ok(!text.includes('Nous Research') && text.includes('the assistant team'), 'default rule');
        assert.ok(!text.includes('Acme Corp'), 'ANTIGRAVITY_SCRUB_IDENTITY rule');
        assert.ok(!text.includes('x-anthropic-billing-header'), 'defaults still apply alongside env rules');
    });

    console.log('\n' + '═'.repeat(60));
    console.log(`Tests completed: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
