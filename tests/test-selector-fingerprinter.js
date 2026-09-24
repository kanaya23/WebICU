/**
 * Test Suite: Selector Fingerprinter
 * Verifies ARIA role mapping, accessible name computation,
 * test ID extraction, and Playwright semantic locators.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running test-selector-fingerprinter.js ---');

// Mock DOM elements
class MockElement {
  constructor(tagName, attrs = {}, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = { ...attrs };
    this.innerText = textContent;
    this.textContent = textContent;
    this.id = attrs.id || '';
    this.className = attrs.class || '';
    this.type = attrs.type || (tagName.toLowerCase() === 'button' ? 'button' : 'text');
    this.parentElement = null;
    this.children = [];
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  setAttribute(name, val) {
    this.attributes[name] = val;
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  getBoundingClientRect() {
    return { x: 100, y: 200, width: 120, height: 40, top: 200, left: 100, right: 220, bottom: 240 };
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (selector.toLowerCase().includes(cur.tagName.toLowerCase())) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

global.window = global;
global.document = {
  documentElement: { nodeType: 1, tagName: 'HTML' }
};
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};

// Load selector-fingerprinter.js
const code = fs.readFileSync(path.join(__dirname, '../content/selector-fingerprinter.js'), 'utf8');
eval(code);

assert(global.__rrwebSelectorFingerprinter, '__rrwebSelectorFingerprinter should be exposed');

// Test 1: Button with accessible name and role
const submitBtn = new MockElement('BUTTON', { type: 'submit' }, 'Submit Order');
const fp1 = global.__rrwebSelectorFingerprinter.fingerprint(submitBtn);

assert.strictEqual(fp1.role, 'button', 'Role should be button');
assert.strictEqual(fp1.accessibleName, 'Submit Order', 'Accessible name should be text content');
assert.strictEqual(fp1.locator.strategy, 'role');
assert.strictEqual(fp1.locator.code, `page.getByRole('button', { name: "Submit Order" })`);
console.log('✓ Test 1 Passed: button semantic ARIA role & locator generation');

// Test 2: Input with data-testid priority
const emailInput = new MockElement('INPUT', { 'data-testid': 'user-email-input', type: 'email', placeholder: 'Enter email' });
const fp2 = global.__rrwebSelectorFingerprinter.fingerprint(emailInput);

assert(fp2.testId, 'Should find testId attribute');
assert.strictEqual(fp2.testId.value, 'user-email-input');
assert.strictEqual(fp2.locator.strategy, 'testid');
assert.strictEqual(fp2.locator.code, `page.getByTestId("user-email-input")`);
console.log('✓ Test 2 Passed: test ID extraction and prioritization');

// Test 3: Bounding box metrics
assert(fp1.boundingBox, 'Should include bounding box');
assert.strictEqual(fp1.boundingBox.width, 120);
assert.strictEqual(fp1.boundingBox.height, 40);
console.log('✓ Test 3 Passed: interaction bounding box capture');

console.log('All Selector Fingerprinter tests passed successfully!\n');
