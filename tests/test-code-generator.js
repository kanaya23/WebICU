/**
 * Test Suite: Code & AI Trajectory Generator
 * Verifies Playwright TypeScript / Python scripts, AI Agent Trajectory,
 * and MSW mock handlers generation.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running test-code-generator.js ---');

global.window = global;

// Load code-generator.js
const code = fs.readFileSync(path.join(__dirname, '../pages/code-generator.js'), 'utf8');
eval(code);

assert(global.__rrwebCodeGenerator, '__rrwebCodeGenerator should be exposed');
assert(global.WebICUCodeGenerator === global.__rrwebCodeGenerator, 'WebICUCodeGenerator alias should be exposed');

// Mock recording events
const mockEvents = [
  // Meta navigation event
  {
    type: 4,
    timestamp: 1700000000000,
    data: { href: 'https://store.example.com/checkout' }
  },
  // Step 1: Input coupon code
  {
    type: 5,
    timestamp: 1700000001000,
    data: {
      tag: 'user-action',
      payload: {
        action: 'input',
        target: 'input[name="coupon"]',
        value: 'DISCOUNT20',
        suggestedLocator: 'page.locator(\'input[name="coupon"]\')',
        fingerprint: {
          testId: { attr: 'data-testid', value: 'coupon-input' }
        }
      }
    }
  },
  // Step 2: Click Apply button
  {
    type: 5,
    timestamp: 1700000002000,
    data: {
      tag: 'user-action',
      payload: {
        action: 'click',
        target: 'button.apply-btn',
        suggestedLocator: 'page.getByRole(\'button\', { name: "Apply" })',
        fingerprint: {
          role: 'button',
          accessibleName: 'Apply'
        }
      }
    }
  },
  // Correlated Network Request triggered by Apply click (250ms after click)
  {
    type: 5,
    timestamp: 1700000002250,
    data: {
      tag: 'network',
      payload: {
        id: 'req_123',
        initiator: 'fetch',
        method: 'POST',
        url: 'https://store.example.com/api/coupons/apply',
        status: 200,
        statusText: 'OK',
        requestBody: JSON.stringify({ code: 'DISCOUNT20' }),
        responseBody: JSON.stringify({ valid: true, discount: 20 })
      }
    }
  }
];

// Mock user annotations (Ideas #4 & #5)
const mockAnnotations = [
  {
    id: 'ann_1',
    type: 'note',
    timestamp: 1700000000800,
    text: 'User applies promotional discount code'
  },
  {
    id: 'ann_2',
    type: 'assert',
    timestamp: 1700000003000,
    assertionType: 'toBeVisible',
    selector: 'text="Discount Applied: -20%"'
  }
];

// 1. Test Playwright TypeScript Generation
const pwTs = global.__rrwebCodeGenerator.generatePlaywrightTS(mockEvents, mockAnnotations);
console.log('Playwright TypeScript preview:\n', pwTs.substring(0, 350) + '...\n');

assert(pwTs.includes('// Generated with WebICU (Web, I See You)'), 'Should include WebICU header');
assert(pwTs.includes('// Step: User applies promotional discount code'), 'Should include human intent comment');
assert(pwTs.includes('await page.goto("https://store.example.com/checkout");'), 'Should navigate to initial URL');
assert(pwTs.includes("input[name=\"coupon\"]"), 'Should generate input locator');
assert(pwTs.includes('DISCOUNT20'), 'Should fill input value');
assert(pwTs.includes("page.getByRole('button', { name: \"Apply\" })"), 'Should generate semantic click');
assert(pwTs.includes("page.waitForResponse("), 'Should auto-generate causal network wait');
assert(pwTs.includes('/api/coupons/apply'), 'Should auto-wait on the correlated endpoint');
assert(pwTs.includes('await expect('), 'Should generate Playwright assertion');
assert(pwTs.includes('.toBeVisible()'), 'Should generate toBeVisible check');
console.log('✓ Test 1 Passed: Playwright TypeScript with causal waits, human comments & assertions');

// 2. Test Playwright Python Generation
const pwPy = global.__rrwebCodeGenerator.generatePlaywrightPython(mockEvents, mockAnnotations);
assert(pwPy.includes('# Generated with WebICU (Web, I See You)'), 'Should include WebICU header');
assert(pwPy.includes('from playwright.sync_api import sync_playwright, expect'), 'Should import Playwright Python');
assert(pwPy.includes('# Step: User applies promotional discount code'), 'Should format python comment');
assert(pwPy.includes('with page.expect_response('), 'Should format python causal wait block');
assert(pwPy.includes('to_be_visible()') && pwPy.includes('Discount Applied: -20%'), 'Should format python assertion');
console.log('✓ Test 2 Passed: Playwright Python export with pythonic assertions & causal waits');

// 3. Test AI Agent Trajectory Generation
const agentMd = global.__rrwebCodeGenerator.generateAgentTrace(mockEvents, mockAnnotations);
assert(agentMd.includes('# AI Agent Interaction Trajectory'), 'Should have trajectory header');
assert(agentMd.includes('**Recorded with:** WebICU (Web, I See You)'), 'Should have WebICU attribution');
assert(agentMd.includes('User applies promotional discount code'), 'Should include human note in trajectory');
assert(agentMd.includes('POST https://store.example.com/api/coupons/apply') && agentMd.includes('[200 OK]'), 'Should include network correlation');
assert(agentMd.includes('text="Discount Applied: -20%"'), 'Should include assertion in trajectory');
console.log('✓ Test 3 Passed: AI Agent Trajectory prompt format');

// 4. Test MSW Mocks Generation
const msw = global.__rrwebCodeGenerator.generateMswHandlers(mockEvents);
assert(msw.includes("import { http, HttpResponse } from 'msw';"), 'Should import MSW');
assert(msw.includes('http.post(') && msw.includes('https://store.example.com/api/coupons/apply'), 'Should create MSW POST mock');
assert(msw.includes('"valid": true'), 'Should mock response JSON body');
console.log('✓ Test 4 Passed: MSW Mock handlers generation');

console.log('All Code & AI Trajectory Generator tests passed successfully!\n');
