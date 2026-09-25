// inject.js - Injected into the page's MAIN world to record DOM, actions, causality & progressive snapshots
(() => {
  // Never run recorder inside embedded iframes or widgets
  if (window !== window.top) return;

  if (window.__webicu_inject_active) {
    window.postMessage({ source: 'webicu-page-inject', action: 'WEBICU_INJECT_READY' }, '*');
    return;
  }
  window.__webicu_inject_active = true;

  let stopRecordingFn = null;
  let activeListeners = [];
  let isRecorderActive = false;
  let layoutShiftSnapshotCount = 0;
  let snapshotCount = 1;
  let lastCapturedUrl = window.location.href;
  let lastSnapshotTimestamp = 0;
  let lastSnapshotNodeCount = 0;
  let settleTimer = null;
  let settleMaxTimeout = null;
  let activeCausalityContext = null;

  // --- Helper: Visual Toast on Snapshot Capture ---
  function showSnapshotToast(text) {
    try {
      let toast = document.getElementById('__webicu_snapshot_toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = '__webicu_snapshot_toast';
        toast.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: #111111;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px;
          font-weight: 600;
          padding: 8px 14px;
          border-radius: 4px;
          border: 1px solid #333333;
          box-shadow: 0 4px 14px rgba(0,0,0,0.35);
          z-index: 2147483647;
          pointer-events: none;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.2s ease, transform 0.2s ease;
        `;
        (document.body || document.documentElement).appendChild(toast);
      }
      toast.textContent = text;
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
      }, 1600);
    } catch (e) {}
  }

  // --- Helper: High-Fidelity Standalone HTML Snapshot Generator ---
  function captureCleanHtmlSnapshot() {
    try {
      const docClone = document.documentElement.cloneNode(true);

      // 1. Synchronize CSS-in-JS rules into <style> elements
      // Emotion, styled-components, Gestalt, etc. use sheet.insertRule(), leaving <style>.textContent empty.
      const origStyles = Array.from(document.querySelectorAll('style'));
      const cloneStyles = Array.from(docClone.querySelectorAll('style'));
      origStyles.forEach((orig, idx) => {
        try {
          if (orig.sheet && orig.sheet.cssRules && orig.sheet.cssRules.length > 0) {
            let cssText = '';
            const rules = orig.sheet.cssRules;
            for (let i = 0; i < rules.length; i++) {
              cssText += rules[i].cssText + '\n';
            }
            if (cloneStyles[idx]) {
              cloneStyles[idx].textContent = cssText;
            }
          }
        } catch (e) {
          // Cross-origin or restricted stylesheet, keep existing textContent
        }
      });

      // 2. Extract Constructable Stylesheets (adoptedStyleSheets)
      if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {
        let adoptedCss = '';
        for (const sheet of document.adoptedStyleSheets) {
          try {
            if (sheet.cssRules) {
              for (let i = 0; i < sheet.cssRules.length; i++) {
                adoptedCss += sheet.cssRules[i].cssText + '\n';
              }
            }
          } catch (e) {}
        }
        if (adoptedCss) {
          const adoptedStyleEl = document.createElement('style');
          adoptedStyleEl.setAttribute('data-inlined-from', 'adoptedStyleSheets');
          adoptedStyleEl.textContent = adoptedCss;
          const head = docClone.querySelector('head') || docClone;
          head.appendChild(adoptedStyleEl);
        }
      }

      // 3. Inline rules from external <link rel="stylesheet"> when readable via CORS/same-origin
      let linkedInlinedCss = '';
      const origLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      origLinks.forEach(link => {
        try {
          if (link.sheet && link.sheet.cssRules && link.sheet.cssRules.length > 0) {
            for (let i = 0; i < link.sheet.cssRules.length; i++) {
              linkedInlinedCss += link.sheet.cssRules[i].cssText + '\n';
            }
          }
        } catch (e) {
          // Cross-origin restricted, will fall back to absolute URL <link> tag
        }
      });

      if (linkedInlinedCss) {
        const extStyleEl = document.createElement('style');
        extStyleEl.setAttribute('data-inlined-from', 'external-stylesheets');
        extStyleEl.textContent = linkedInlinedCss;
        const head = docClone.querySelector('head') || docClone;
        head.appendChild(extStyleEl);
      }

      // 4. Ensure all remaining <link rel="stylesheet"> have absolute hrefs
      docClone.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          try {
            link.setAttribute('href', new URL(href, window.location.href).href);
          } catch (e) {}
        }
      });

      // 5. High-fidelity image capture: resolve currentSrc, data-src, srcset, and bypass CDN hotlink protection
      const origImgs = Array.from(document.querySelectorAll('img'));
      const cloneImgs = Array.from(docClone.querySelectorAll('img'));
      origImgs.forEach((orig, idx) => {
        const clone = cloneImgs[idx];
        if (!clone) return;

        // Use the browser's actually rendered image source (currentSrc)
        const effectiveSrc = orig.currentSrc || orig.src || orig.getAttribute('src');
        if (effectiveSrc) {
          try {
            clone.setAttribute('src', new URL(effectiveSrc, window.location.href).href);
          } catch (e) {
            clone.setAttribute('src', effectiveSrc);
          }
        }

        // Check lazy attributes if src is empty or tiny placeholder
        const dataSrc = orig.getAttribute('data-src') || orig.getAttribute('data-original') || orig.getAttribute('data-pin-media');
        if (dataSrc && (!clone.getAttribute('src') || clone.getAttribute('src').startsWith('data:image/svg') || clone.getAttribute('src').includes('placeholder'))) {
          try {
            clone.setAttribute('src', new URL(dataSrc, window.location.href).href);
          } catch (e) {}
        }

        // Convert srcset to absolute URLs
        const srcset = clone.getAttribute('srcset');
        if (srcset) {
          try {
            const parts = srcset.split(',').map(entry => {
              const tokens = entry.trim().split(/\s+/);
              if (tokens[0]) {
                tokens[0] = new URL(tokens[0], window.location.href).href;
              }
              return tokens.join(' ');
            });
            clone.setAttribute('srcset', parts.join(', '));
          } catch (e) {}
        }

        clone.removeAttribute('loading');
        clone.setAttribute('referrerpolicy', 'no-referrer');
      });

      // 6. Synchronize form inputs, checkboxes, textareas, selects
      const origInputs = Array.from(document.querySelectorAll('input, textarea, select'));
      const cloneInputs = Array.from(docClone.querySelectorAll('input, textarea, select'));
      origInputs.forEach((orig, idx) => {
        const clone = cloneInputs[idx];
        if (!clone) return;
        if (orig.tagName === 'INPUT') {
          if (orig.type === 'checkbox' || orig.type === 'radio') {
            if (orig.checked) clone.setAttribute('checked', '');
            else clone.removeAttribute('checked');
          } else {
            clone.setAttribute('value', orig.value);
          }
        } else if (orig.tagName === 'TEXTAREA') {
          clone.textContent = orig.value;
        } else if (orig.tagName === 'SELECT') {
          Array.from(clone.options).forEach((opt, oIdx) => {
            if (orig.options[oIdx]?.selected) opt.setAttribute('selected', '');
            else opt.removeAttribute('selected');
          });
        }
      });

      // 7. Render dynamic canvases to static data URLs
      const origCanvases = Array.from(document.querySelectorAll('canvas'));
      const cloneCanvases = Array.from(docClone.querySelectorAll('canvas'));
      origCanvases.forEach((orig, idx) => {
        try {
          const clone = cloneCanvases[idx];
          if (clone && orig.width > 0 && orig.height > 0) {
            const img = document.createElement('img');
            img.src = orig.toDataURL();
            img.className = clone.className;
            if (clone.getAttribute('style')) img.setAttribute('style', clone.getAttribute('style'));
            clone.replaceWith(img);
          }
        } catch (e) {}
      });

      // 8. Preserve root/body theme styles (background color, text color, primary font)
      try {
        const computedBody = window.getComputedStyle(document.body);
        const computedHtml = window.getComputedStyle(document.documentElement);
        const cloneBody = docClone.querySelector('body');
        if (cloneBody) {
          if (!cloneBody.style.backgroundColor && computedBody.backgroundColor) {
            cloneBody.style.backgroundColor = computedBody.backgroundColor;
          }
          if (!cloneBody.style.color && computedBody.color) {
            cloneBody.style.color = computedBody.color;
          }
          if (!cloneBody.style.fontFamily && computedBody.fontFamily) {
            cloneBody.style.fontFamily = computedBody.fontFamily;
          }
        }
        if (computedHtml.backgroundColor && computedHtml.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          docClone.style.backgroundColor = computedHtml.backgroundColor;
        }
      } catch (e) {}

      // 9. Strip script tags to prevent any script re-execution offline
      docClone.querySelectorAll('script').forEach(s => s.remove());

      // 10. Strip tracking iframes & noscripts
      docClone.querySelectorAll('iframe').forEach(f => {
        const src = (f.getAttribute('src') || '').toLowerCase();
        if (src.includes('google') || src.includes('facebook') || src.includes('analytics') || src.includes('doubleclick') || !src) {
          f.remove();
        }
      });
      docClone.querySelectorAll('noscript').forEach(n => n.remove());

      // 11. Ensure <meta name="referrer" content="no-referrer"> to allow CDN images to load without hotlink blocking
      const head = docClone.querySelector('head') || docClone;
      let refMeta = docClone.querySelector('meta[name="referrer"]');
      if (!refMeta) {
        refMeta = document.createElement('meta');
        refMeta.name = 'referrer';
        refMeta.content = 'no-referrer';
        head.insertBefore(refMeta, head.firstChild);
      } else {
        refMeta.setAttribute('content', 'no-referrer');
      }

      // 12. Ensure base href
      let baseTag = docClone.querySelector('base');
      if (!baseTag) {
        baseTag = document.createElement('base');
        baseTag.href = window.location.href;
        head.insertBefore(baseTag, head.firstChild);
      } else {
        baseTag.setAttribute('href', window.location.href);
      }

      return '<!DOCTYPE html>\n' + docClone.outerHTML;
    } catch (err) {
      console.warn('[WebICU] Error capturing clean snapshot:', err);
      return '<!DOCTYPE html>\n<html><head><meta name="referrer" content="no-referrer"></head><body>' + document.body.innerHTML + '</body></html>';
    }
  }

  // --- Helper: Robust Unique Selector Generator ---
  function computeUniqueCssSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    
    // 1. Check data-testid attributes
    const testAttr = el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test');
    if (testAttr) return `[data-testid="${testAttr}"]`;

    // 2. Check unique clean ID
    if (el.id && !/^\d/.test(el.id) && !el.id.includes(':')) {
      try {
        if (document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
          return `#${CSS.escape(el.id)}`;
        }
      } catch (e) {}
    }

    // 3. Fallback: Tag + significant classes or hierarchy
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id && !/^\d/.test(current.id)) {
        part += `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      } else {
        const classNames = Array.from(current.classList).filter(c => !c.includes(':') && c.length < 30);
        if (classNames.length > 0) {
          part += `.${classNames.slice(0, 2).map(CSS.escape).join('.')}`;
        }
        parts.unshift(part);
      }
      current = current.parentElement;
      if (parts.length >= 3) break;
    }
    return parts.join(' > ');
  }

  function computeXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return `//*[@id="${el.id}"]`;
    const paths = [];
    for (; el && el.nodeType === Node.ELEMENT_NODE; el = el.parentNode) {
      let index = 0;
      for (let sibling = el.previousSibling; sibling; sibling = sibling.previousSibling) {
        if (sibling.nodeType === Node.DOCUMENT_TYPE_NODE) continue;
        if (sibling.nodeName === el.nodeName) ++index;
      }
      const tagName = el.nodeName.toLowerCase();
      const pathIndex = index ? `[${index + 1}]` : '';
      paths.unshift(tagName + pathIndex);
      if (paths.length >= 4) break;
    }
    return paths.length ? '/' + paths.join('/') : '';
  }

  // --- Settle-Aware Progressive Snapshot Scheduler ---
  function scheduleSettledSnapshot(triggerReason, debounceMs = 650, maxWaitMs = 2500) {
    clearTimeout(settleTimer);

    if (!settleMaxTimeout) {
      settleMaxTimeout = setTimeout(() => {
        settleMaxTimeout = null;
        clearTimeout(settleTimer);
        settleTimer = null;
        executeProgressiveSnapshot(triggerReason);
      }, maxWaitMs);
    }

    settleTimer = setTimeout(() => {
      if (settleMaxTimeout) {
        clearTimeout(settleMaxTimeout);
        settleMaxTimeout = null;
      }
      settleTimer = null;
      executeProgressiveSnapshot(triggerReason);
    }, debounceMs);
  }

  function executeProgressiveSnapshot(triggerReason) {
    if (!isRecorderActive) return;
    if (!window.rrweb || !window.rrweb.record || typeof window.rrweb.record.addCustomEvent !== 'function') return;

    const now = Date.now();
    const currentNodeCount = document.querySelectorAll('*').length;
    const currentUrl = window.location.href;

    // Protection against excessive automatic background layout shifts on streaming/heavy apps
    if (triggerReason === 'LAYOUT_SHIFT') {
      if (layoutShiftSnapshotCount >= 10) return;
      if ((now - lastSnapshotTimestamp) < 15000) return;
      const nodeDiff = Math.abs(currentNodeCount - lastSnapshotNodeCount);
      if (nodeDiff < Math.max(50, lastSnapshotNodeCount * 0.2)) return;
      layoutShiftSnapshotCount++;
    }

    // Deduplication filter:
    // User interactions that revealed UI (UI_EXPANDED), hotkeys, or initial loads always capture the updated state!
    const isExplicitTrigger = triggerReason.startsWith('UI_EXPANDED') || triggerReason.startsWith('MANUAL') || triggerReason === 'INITIAL_LOAD';
    if (!isExplicitTrigger && currentUrl === lastCapturedUrl && (now - lastSnapshotTimestamp) < 3000) {
      const nodeDiff = Math.abs(currentNodeCount - lastSnapshotNodeCount);
      const minSignificantDiff = Math.max(30, lastSnapshotNodeCount * 0.15);
      if (nodeDiff < minSignificantDiff) {
        return; // skip redundant background layout shift
      }
    }

    lastCapturedUrl = currentUrl;
    lastSnapshotTimestamp = now;
    lastSnapshotNodeCount = currentNodeCount;

    const html = captureCleanHtmlSnapshot();
    const payload = {
      snapshotIndex: snapshotCount++,
      triggerReason,
      url: currentUrl,
      title: document.title,
      html,
      timestamp: now
    };

    window.rrweb.record.addCustomEvent('rolling-snapshot', payload);
    showSnapshotToast(`Snapshot #${payload.snapshotIndex} captured (${triggerReason})`);
  }

  function resolveInteractiveElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return el;
    const candidate = el.closest('button, [role="button"], a, input, select, textarea, [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [tabindex], [aria-haspopup], [aria-expanded], label, summary, [data-test], [data-testid]');
    if (candidate) return candidate;

    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      try {
        const style = window.getComputedStyle(curr);
        if (style && style.cursor === 'pointer') {
          return curr;
        }
      } catch (e) {}
      curr = curr.parentElement;
    }
    return el;
  }

  function extractElementReadableText(el) {
    if (!el) return '';
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder');
    if (aria) return aria.trim().substring(0, 80);

    const inner = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    if (inner && inner.length < 80) return inner;

    const childImg = el.querySelector('img[alt], svg title');
    if (childImg) {
      const alt = childImg.getAttribute('alt') || childImg.textContent;
      if (alt) return alt.trim().substring(0, 80);
    }

    return (inner || el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
  }

  // --- Helper: Semantic Subtree Extractor for Spawned UI Containers ---
  function extractSemanticSubtree(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

    // 1. Detect repeating or structured item candidates (comments, list items, cards, options)
    const itemCandidates = Array.from(el.querySelectorAll(
      '[role="listitem"], [data-test-id*="comment"], [data-testid*="comment"], [class*="comment" i], article, li, [role="menuitem"], [role="option"]'
    ));

    // Filter to top-level items among candidates (avoid capturing sub-elements of an item as distinct root items)
    const rootItems = itemCandidates.filter(item => {
      let parent = item.parentElement;
      while (parent && parent !== el) {
        if (itemCandidates.includes(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });

    const structuredItems = [];
    const maxItemsToExtract = 50;

    rootItems.slice(0, maxItemsToExtract).forEach(item => {
      // Author extraction (profile links, user handles, bold authors)
      const authorEl = item.querySelector(
        '[data-test-id*="author"], [data-testid*="author"], [class*="author" i], a[href*="/pin/"], a[href*="/@"], a[href*="/user/"], a[href*="id.pinterest.com/"], a[href*="pinterest.com/"]'
      ) || item.querySelector('strong, b, h4, h5');

      let author = '';
      let authorUrl = '';
      if (authorEl) {
        author = (authorEl.innerText || authorEl.textContent || '').trim().replace(/\s+/g, ' ');
        if (authorEl.tagName === 'A') {
          authorUrl = authorEl.href;
        } else {
          const parentA = authorEl.closest('a');
          if (parentA) authorUrl = parentA.href;
        }
      }

      // Relative timestamp extraction
      const timeEl = item.querySelector('time, [data-test-id*="time"], [class*="time" i], [class*="date" i]');
      let timeStr = '';
      if (timeEl) {
        timeStr = (timeEl.innerText || timeEl.textContent || timeEl.getAttribute('datetime') || '').trim();
      } else {
        const textContent = item.innerText || '';
        const timeMatch = textContent.match(/\b\d+\s*(?:hr|h|mgg|minggu|bulan|bln|hari|d|m|min|s|sec|detik|yr|thn|ago)\b/i);
        if (timeMatch) timeStr = timeMatch[0];
      }

      // Reactions / likes extraction
      const reactionEl = item.querySelector(
        '[data-test-id*="reaction"], [data-test-id*="like"], [class*="reaction" i], [class*="like" i]'
      );
      let reactions = '';
      if (reactionEl) {
        reactions = (reactionEl.innerText || reactionEl.textContent || '').trim();
      }

      // Main body text
      const textContainer = item.querySelector('[data-test-id*="text"], p') || item;
      let itemText = (textContainer.innerText || textContainer.textContent || '').trim().replace(/\s+/g, ' ');
      if (author && itemText.startsWith(author)) {
        itemText = itemText.substring(author.length).trim();
      }

      if (itemText || author) {
        structuredItems.push({
          author: author || undefined,
          authorUrl: authorUrl || undefined,
          time: timeStr || undefined,
          reactions: reactions || undefined,
          text: itemText.substring(0, 300)
        });
      }
    });

    // Extract headings
    const headings = Array.from(el.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map(h => (h.innerText || h.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 6);

    // Extract primary links
    const links = Array.from(el.querySelectorAll('a[href]'))
      .map(a => ({
        text: (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60),
        href: a.href
      }))
      .filter(l => l.text && l.href && !l.href.startsWith('javascript:'))
      .slice(0, 15);

    // Clean multiline text preview
    const rawText = (el.innerText || el.textContent || '').trim();
    const textLines = rawText
      .split('\n')
      .map(line => line.trim().replace(/\s+/g, ' '))
      .filter(line => line.length > 0)
      .slice(0, 40);

    return {
      total_text_length: rawText.length,
      headings: headings.length > 0 ? headings : undefined,
      structured_items: structuredItems.length > 0 ? structuredItems : undefined,
      items_count: structuredItems.length > 0 ? structuredItems.length : undefined,
      text_preview: textLines.slice(0, 12),
      links: links.length > 0 ? links : undefined
    };
  }

  // --- Causality Window & Interaction Tracker ---
  let causalityTimer = null;
  let causalityMaxTimeout = null;

  function finalizeCausalityContext(context) {
    if (!context || context.finalized) return;
    context.finalized = true;

    const associatedEffects = [];
    const disassociatedNoise = [];

    // 1. Check attribute changes on target or related elements (aria-expanded, class, etc.)
    context.capturedMutations.forEach(mut => {
      if (mut.type === 'attribute_change') {
        const isTarget = mut.elementRef === context.targetElement || (context.targetElement && context.targetElement.contains(mut.elementRef));
        const isAria = mut.attributeName?.startsWith('aria-') || mut.attributeName === 'class' || mut.attributeName === 'style';
        if (isTarget && isAria) {
          associatedEffects.push({
            type: 'attribute_change',
            tag: mut.tag,
            role: 'state_change',
            selector: mut.selector,
            summary: `State change: ${mut.attributeName} updated on <${mut.tag}>`,
            confidence: 0.95
          });
        }
      }
    });

    // 2. Identify top-level roots among all added elements
    const addedNodeMutations = context.capturedMutations.filter(m => m.type === 'node_added');
    const addedElements = addedNodeMutations.map(m => m.elementRef).filter(Boolean);

    // Filter to find root elements among addedElements (elements whose parents are NOT in addedElements)
    const rootAddedMutations = addedNodeMutations.filter(m => {
      if (!m.elementRef) return false;
      let parent = m.elementRef.parentElement;
      while (parent) {
        if (addedElements.includes(parent)) {
          return false; // has an added ancestor, so it's a child not a root
        }
        parent = parent.parentElement;
      }
      return true;
    });

    rootAddedMutations.forEach(rootMut => {
      const el = rootMut.elementRef;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: rootMut.width, height: rootMut.height };
      const descendantCount = el.querySelectorAll ? el.querySelectorAll('*').length + 1 : 1;
      const containerText = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const role = el.getAttribute('role') || (rect.height > 100 ? 'content_panel' : 'interactive_ui');

      // Resilient layout check: Handles Pinterest / SPA offscreen measurement tricks (e.g. top: -9999px)
      const hasContent = containerText.length > 0 || descendantCount > 1;
      const isVisibleOrMeasured = (rect.width > 0 && rect.height > 0) || hasContent || role === 'dialog' || role === 'alert';

      if (isVisibleOrMeasured && hasContent) {
        const semanticData = extractSemanticSubtree(el);
        const displayLabel = containerText.substring(0, 90);
        const summaryText = displayLabel
          ? `Spawned UI: "${displayLabel}" (${descendantCount} element${descendantCount > 1 ? 's' : ''})`
          : `Spawned <${rootMut.tag}> container (${descendantCount} elements)`;

        associatedEffects.push({
          type: 'spawned_container',
          tag: rootMut.tag,
          role: role,
          selector: rootMut.selector,
          summary: summaryText,
          spawned_content: semanticData,
          confidence: 0.95
        });
      } else {
        disassociatedNoise.push({
          type: rootMut.type,
          tag: rootMut.tag,
          selector: rootMut.selector,
          reason: 'zero_dimensions_or_hidden'
        });
      }
    });

    const nonRootCount = addedNodeMutations.length - rootAddedMutations.length;
    if (nonRootCount > 0 && associatedEffects.length === 0) {
      disassociatedNoise.push({
        type: 'batch',
        tag: 'elements',
        selector: 'descendants',
        reason: 'nested_sub_nodes'
      });
    }

    const actionPayload = {
      actionId: context.actionId,
      actionType: context.actionType,
      target: {
        tag: context.tag,
        text: context.text,
        role: context.role,
        ariaLabel: context.ariaLabel,
        cssSelector: context.cssSelector,
        xpath: context.xpath,
        coords: context.coords
      },
      submitted_inputs: context.submittedInputs || undefined,
      timestamp: context.timestamp,
      associated_effects: associatedEffects,
      associated_network_requests: context.associatedNetworkRequests || [],
      disassociated_background_events: disassociatedNoise
    };

    if (window.rrweb && window.rrweb.record && typeof window.rrweb.record.addCustomEvent === 'function') {
      window.rrweb.record.addCustomEvent('rolling-action', actionPayload);
    }

    // Capture progressive snapshot for significant UI expansion
    if (associatedEffects.length > 0) {
      const summaryLabel = (context.text || context.tag || 'UI').substring(0, 30);
      scheduleSettledSnapshot(`UI_EXPANDED (${summaryLabel})`, 600, 2500);
    }
  }

  // --- Helper: Extract Associated Form/Dialog Input Values on Interaction ---
  function extractAssociatedFormInputs(targetEl) {
    if (!targetEl) return undefined;

    const results = [];
    const seenElements = new Set();

    function captureField(el) {
      if (!el || seenElements.has(el)) return;
      seenElements.add(el);

      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || 'text').toLowerCase();

      // Skip non-data or control buttons
      if (['submit', 'button', 'reset', 'image', 'hidden'].includes(type)) return;

      const name = el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      
      let val = '';
      if (type === 'password') {
        val = el.value ? '••••••••' : '';
      } else if (type === 'checkbox' || type === 'radio') {
        if (!el.checked) return;
        val = el.value || 'checked';
      } else if (tag === 'select') {
        val = el.value;
      } else if (tag === 'textarea' || tag === 'input') {
        val = el.value;
      } else if (el.isContentEditable) {
        val = el.innerText || el.textContent || '';
      }

      const trimmed = (val || '').trim();
      if (trimmed.length > 0) {
        results.push({
          tag,
          type,
          name: name || undefined,
          value: trimmed.substring(0, 500)
        });
      }
    }

    // 1. If target itself is an input/textarea (e.g. Enter pressed or clicked)
    if (['input', 'textarea', 'select'].includes(targetEl.tagName.toLowerCase()) || targetEl.isContentEditable) {
      captureField(targetEl);
    }

    // 2. If target is inside a form
    const form = targetEl.closest('form');
    if (form) {
      form.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach(captureField);
    }

    // 3. If target is inside a dialog/modal container
    const dialog = targetEl.closest('dialog, [role="dialog"], [role="alertdialog"], .mat-mdc-dialog-container, .modal, [class*="dialog" i], [class*="modal" i]');
    if (dialog) {
      dialog.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach(captureField);
    }

    // 4. If target is a submit / action button, check immediate container or parent controls
    const isActionBtn = targetEl.tagName === 'BUTTON' || targetEl.getAttribute('role') === 'button' || targetEl.getAttribute('type') === 'submit';
    if (isActionBtn && results.length === 0) {
      let container = targetEl.parentElement;
      for (let depth = 0; depth < 3 && container && container !== document.body; depth++) {
        container.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach(captureField);
        if (results.length > 0) break;
        container = container.parentElement;
      }
    }

    return results.length > 0 ? results : undefined;
  }

  function startCausalityWindow(actionType, targetEl, event) {
    if (activeCausalityContext) {
      clearTimeout(causalityTimer);
      clearTimeout(causalityMaxTimeout);
      finalizeCausalityContext(activeCausalityContext);
    }

    const text = extractElementReadableText(targetEl);
    const coords = event ? { x: Math.round(event.clientX), y: Math.round(event.clientY) } : { x: 0, y: 0 };
    const submittedInputs = extractAssociatedFormInputs(targetEl);

    activeCausalityContext = {
      actionId: 'act_' + Date.now(),
      actionType,
      tag: targetEl.tagName.toLowerCase(),
      text,
      role: targetEl.getAttribute('role') || targetEl.tagName.toLowerCase(),
      ariaLabel: targetEl.getAttribute('aria-label'),
      ariaControls: targetEl.getAttribute('aria-controls'),
      cssSelector: computeUniqueCssSelector(targetEl),
      xpath: computeXPath(targetEl),
      coords,
      targetElement: targetEl,
      timestamp: Date.now(),
      submittedInputs,
      capturedMutations: [],
      associatedNetworkRequests: [],
      finalized: false
    };

    clearTimeout(causalityTimer);
    clearTimeout(causalityMaxTimeout);

    // Hard cap timeout: ensures causality context is sealed even in continuous animation
    causalityMaxTimeout = setTimeout(() => {
      if (activeCausalityContext && !activeCausalityContext.finalized) {
        finalizeCausalityContext(activeCausalityContext);
        activeCausalityContext = null;
      }
    }, 2500);

    // Minimum window: stays open for at least 950ms so async API calls (e.g. comments fetch) return
    causalityTimer = setTimeout(() => {
      if (activeCausalityContext && !activeCausalityContext.finalized) {
        finalizeCausalityContext(activeCausalityContext);
        activeCausalityContext = null;
      }
    }, 950);
  }

  // --- Setup Interaction & DOM Observers ---
  function setupInteractionCapturing() {
    let lastInteractionTime = 0;
    let lastInteractionTarget = null;

    function onCaptureInteraction(e) {
      const rawEl = e.target;
      if (!rawEl || rawEl === document.documentElement || rawEl === document.body) return;
      const targetEl = resolveInteractiveElement(rawEl);

      const now = Date.now();
      if (targetEl === lastInteractionTarget && (now - lastInteractionTime) < 350) {
        return;
      }
      lastInteractionTime = now;
      lastInteractionTarget = targetEl;

      startCausalityWindow('click', targetEl, e);
    }

    function onCaptureKeydown(e) {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        executeProgressiveSnapshot('MANUAL_HOTKEY');
        return;
      }
      if (e.key === 'Enter' && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        startCausalityWindow('submit', e.target, null);
      }
    }

    // Live Mutation Observer for Causality Window
    const mutationObserver = new MutationObserver((mutations) => {
      if (!activeCausalityContext || activeCausalityContext.finalized) return;

      // Extend causality window if mutations are actively streaming in
      // Ensure we keep at least 950ms total window, and wait for 500ms of quiet time after ongoing mutations
      const elapsed = Date.now() - activeCausalityContext.timestamp;
      const remainingMin = Math.max(0, 950 - elapsed);
      const delay = Math.max(remainingMin, 500);

      clearTimeout(causalityTimer);
      causalityTimer = setTimeout(() => {
        if (activeCausalityContext && !activeCausalityContext.finalized) {
          finalizeCausalityContext(activeCausalityContext);
          activeCausalityContext = null;
        }
      }, delay);

      mutations.forEach(m => {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { width: 0, height: 0 };
              const summary = (node.innerText || node.textContent || '').trim().substring(0, 70);
              const snippet = node.outerHTML ? node.outerHTML.substring(0, 200) : '';

              activeCausalityContext.capturedMutations.push({
                type: 'node_added',
                tag: node.tagName.toLowerCase(),
                role: node.getAttribute('role') || '',
                className: String(node.className || ''),
                id: node.id || '',
                selector: computeUniqueCssSelector(node),
                width: rect.width,
                height: rect.height,
                textSummary: summary,
                htmlSnippet: snippet,
                elementRef: node
              });
            }
          });
        } else if (m.type === 'attributes') {
          const target = m.target;
          if (target && target.nodeType === Node.ELEMENT_NODE) {
            const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { width: 0, height: 0 };
            activeCausalityContext.capturedMutations.push({
              type: 'attribute_change',
              attributeName: m.attributeName,
              tag: target.tagName.toLowerCase(),
              role: target.getAttribute('role') || '',
              className: String(target.className || ''),
              id: target.id || '',
              selector: computeUniqueCssSelector(target),
              width: rect.width,
              height: rect.height,
              textSummary: `Attribute ${m.attributeName} changed on <${target.tagName.toLowerCase()}>`,
              htmlSnippet: '',
              elementRef: target
            });
          }
        }
      });
    });

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'hidden']
    });

    // SPA Navigation Detection (pushState, replaceState, popstate, hashchange)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      scheduleSettledSnapshot('SPA_PUSH_STATE', 700, 2800);
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      scheduleSettledSnapshot('SPA_REPLACE_STATE', 700, 2800);
    };

    const onPopstate = () => scheduleSettledSnapshot('SPA_POP_STATE', 700, 2800);
    const onHashchange = () => scheduleSettledSnapshot('HASH_CHANGE', 700, 2800);

    window.addEventListener('popstate', onPopstate);
    window.addEventListener('hashchange', onHashchange);

    // Major Layout Shift Detection
    const layoutObserver = new MutationObserver((mutations) => {
      let addedElementsCount = 0;
      mutations.forEach(m => {
        addedElementsCount += m.addedNodes.length;
      });

      // If active settling timer is running (from route change), reset it so we wait for this incoming batch
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (settleMaxTimeout) {
            clearTimeout(settleMaxTimeout);
            settleMaxTimeout = null;
          }
          settleTimer = null;
          executeProgressiveSnapshot('SPA_PUSH_STATE');
        }, 650);
      } else if (addedElementsCount > 45) {
        // Significant structural addition (e.g. search engine results or modal dialog)
        scheduleSettledSnapshot('LAYOUT_SHIFT', 700, 2500);
      }
    });

    layoutObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('pointerdown', onCaptureInteraction, true);
    document.addEventListener('click', onCaptureInteraction, true);
    document.addEventListener('keydown', onCaptureKeydown, true);

    activeListeners = [
      () => document.removeEventListener('pointerdown', onCaptureInteraction, true),
      () => document.removeEventListener('click', onCaptureInteraction, true),
      () => document.removeEventListener('keydown', onCaptureKeydown, true),
      () => window.removeEventListener('popstate', onPopstate),
      () => window.removeEventListener('hashchange', onHashchange),
      () => mutationObserver.disconnect(),
      () => layoutObserver.disconnect(),
      () => {
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
      },
      () => {
        clearTimeout(settleTimer);
        clearTimeout(settleMaxTimeout);
        clearTimeout(causalityTimer);
        clearTimeout(causalityMaxTimeout);
        const toast = document.getElementById('__webicu_snapshot_toast');
        if (toast) toast.remove();
      }
    ];
  }

  // --- Network Traffic Interceptor (Lossless Fetch & XHR Proxy) ---
  let originalFetch = null;
  let originalXHROpen = null;
  let originalXHRSend = null;
  let originalXHRSetRequestHeader = null;
  let networkReqCounter = 0;

  function emitNetworkEvent(payload) {
    try {
      if (window.rrweb && window.rrweb.record && typeof window.rrweb.record.addCustomEvent === 'function') {
        window.rrweb.record.addCustomEvent('rolling-network', payload);
      }
    } catch (e) {
      console.warn('[WebICU] Failed to emit rolling-network event:', e);
    }
  }

  function setupNetworkCapturing() {
    if (originalFetch) return; // Already setup

    originalFetch = window.fetch;
    originalXHROpen = XMLHttpRequest.prototype.open;
    originalXHRSend = XMLHttpRequest.prototype.send;
    originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    // 1. Monkey-patch window.fetch
    window.fetch = async function(input, init) {
      const startTime = Date.now();
      const requestId = 'req_' + startTime + '_' + (++networkReqCounter);

      let method = 'GET';
      let url = '';
      const requestHeaders = {};
      let requestBody = null;

      try {
        if (typeof input === 'string') {
          url = new URL(input, window.location.href).href;
        } else if (input instanceof URL) {
          url = input.href;
        } else if (input && typeof input === 'object' && 'url' in input) {
          url = input.url;
          method = (input.method || 'GET').toUpperCase();
        }

        if (init && init.method) {
          method = String(init.method).toUpperCase();
        }

        // Extract Request Headers
        const rawHeaders = (init && init.headers) || (input && typeof input === 'object' && input.headers);
        if (rawHeaders) {
          if (typeof rawHeaders.forEach === 'function') {
            rawHeaders.forEach((val, key) => { requestHeaders[key] = val; });
          } else if (Array.isArray(rawHeaders)) {
            rawHeaders.forEach(([k, v]) => { requestHeaders[k] = v; });
          } else if (typeof rawHeaders === 'object') {
            Object.assign(requestHeaders, rawHeaders);
          }
        }

        // Extract Request Body (safe lossless extraction)
        const rawBody = (init && init.body !== undefined) ? init.body : (input && typeof input === 'object' && input.body);
        if (rawBody !== undefined && rawBody !== null) {
          if (typeof rawBody === 'string') {
            try {
              requestBody = JSON.parse(rawBody);
            } catch (_) {
              requestBody = rawBody;
            }
          } else if (rawBody instanceof URLSearchParams) {
            requestBody = rawBody.toString();
          } else if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
            const fdObj = {};
            try {
              rawBody.forEach((v, k) => {
                fdObj[k] = (typeof v === 'string') ? v : `[File: ${v.name || 'blob'} (${v.size} bytes)]`;
              });
              requestBody = fdObj;
            } catch (_) {
              requestBody = '[FormData]';
            }
          } else if (rawBody instanceof Blob) {
            requestBody = `[Blob: ${rawBody.type || 'binary'} (${rawBody.size} bytes)]`;
          } else if (rawBody instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(rawBody))) {
            requestBody = `[Binary: byteLength=${rawBody.byteLength}]`;
          } else {
            try {
              requestBody = JSON.parse(JSON.stringify(rawBody));
            } catch (_) {
              requestBody = String(rawBody);
            }
          }
        }
      } catch (err) {
        url = url || String(input || '');
      }

      // Check Causality Association
      let associatedActionId = null;
      if (activeCausalityContext && !activeCausalityContext.finalized) {
        associatedActionId = activeCausalityContext.actionId;
        if (!activeCausalityContext.associatedNetworkRequests) {
          activeCausalityContext.associatedNetworkRequests = [];
        }
        activeCausalityContext.associatedNetworkRequests.push({
          requestId,
          method,
          url,
          timestamp: startTime
        });
      }

      try {
        const response = await originalFetch.apply(this, arguments);
        const endTime = Date.now();
        const durationMs = Math.max(0, endTime - startTime);

        // Extract Response Headers
        const responseHeaders = {};
        try {
          if (response.headers && typeof response.headers.forEach === 'function') {
            response.headers.forEach((val, key) => { responseHeaders[key] = val; });
          }
        } catch (_) {}

        // Read cloned response body asynchronously so web app data stream is never consumed or delayed
        (async () => {
          let responseBody = null;
          try {
            const contentType = response.headers && typeof response.headers.get === 'function'
              ? (response.headers.get('content-type') || '')
              : '';
            if (contentType.includes('image/') || contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('font/')) {
              responseBody = `[Binary Media: ${contentType}]`;
            } else {
              const clone = response.clone();
              const text = await clone.text();
              if (text.length > 500000) {
                responseBody = text.substring(0, 500000) + '... (truncated, size > 500KB)';
              } else {
                try {
                  responseBody = JSON.parse(text);
                } catch (_) {
                  responseBody = text;
                }
              }
            }
          } catch (cloneErr) {
            responseBody = `[Body unreadable: ${cloneErr.message}]`;
          }

          emitNetworkEvent({
            requestId,
            associatedActionId,
            initiator: 'fetch',
            method,
            url,
            startTime,
            endTime,
            durationMs,
            status: response.status,
            statusText: response.statusText,
            requestHeaders,
            requestBody,
            responseHeaders,
            responseBody
          });

          // Extend causality window if action is actively awaiting network response
          if (activeCausalityContext && !activeCausalityContext.finalized && activeCausalityContext.actionId === associatedActionId) {
            clearTimeout(causalityTimer);
            causalityTimer = setTimeout(() => {
              if (activeCausalityContext && !activeCausalityContext.finalized) {
                finalizeCausalityContext(activeCausalityContext);
                activeCausalityContext = null;
              }
            }, 500);
          }
        })().catch(() => {});

        return response;
      } catch (err) {
        const endTime = Date.now();
        const durationMs = Math.max(0, endTime - startTime);

        emitNetworkEvent({
          requestId,
          associatedActionId,
          initiator: 'fetch',
          method,
          url,
          startTime,
          endTime,
          durationMs,
          status: 0,
          statusText: 'Failed',
          requestHeaders,
          requestBody,
          responseHeaders: {},
          responseBody: null,
          error: err?.message || String(err)
        });

        throw err;
      }
    };

    // 2. Monkey-patch XMLHttpRequest
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__webicu_reqId = 'req_' + Date.now() + '_' + (++networkReqCounter);
      this.__webicu_method = (method || 'GET').toUpperCase();
      try {
        this.__webicu_url = new URL(url, window.location.href).href;
      } catch (_) {
        this.__webicu_url = String(url || '');
      }
      this.__webicu_headers = {};
      return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
      if (this.__webicu_headers) {
        this.__webicu_headers[header] = value;
      }
      return originalXHRSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const startTime = Date.now();
      const requestId = this.__webicu_reqId || ('req_' + startTime + '_' + (++networkReqCounter));
      const method = this.__webicu_method || 'GET';
      const url = this.__webicu_url || '';
      const requestHeaders = this.__webicu_headers || {};
      let requestBody = null;

      try {
        if (body !== undefined && body !== null) {
          if (typeof body === 'string') {
            try {
              requestBody = JSON.parse(body);
            } catch (_) {
              requestBody = body;
            }
          } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
            const fdObj = {};
            try {
              body.forEach((v, k) => {
                fdObj[k] = (typeof v === 'string') ? v : `[File: ${v.name || 'blob'} (${v.size} bytes)]`;
              });
              requestBody = fdObj;
            } catch (_) {
              requestBody = '[FormData]';
            }
          } else if (body instanceof URLSearchParams) {
            requestBody = body.toString();
          } else {
            requestBody = String(body);
          }
        }
      } catch (_) {}

      // Causality Association
      let associatedActionId = null;
      if (activeCausalityContext && !activeCausalityContext.finalized) {
        associatedActionId = activeCausalityContext.actionId;
        if (!activeCausalityContext.associatedNetworkRequests) {
          activeCausalityContext.associatedNetworkRequests = [];
        }
        activeCausalityContext.associatedNetworkRequests.push({
          requestId,
          method,
          url,
          timestamp: startTime
        });
      }

      const onComplete = () => {
        const endTime = Date.now();
        const durationMs = Math.max(0, endTime - startTime);

        // Parse response headers
        const responseHeaders = {};
        try {
          const rawH = this.getAllResponseHeaders();
          if (rawH) {
            rawH.split('\r\n').forEach(line => {
              const colonIdx = line.indexOf(':');
              if (colonIdx > 0) {
                const k = line.substring(0, colonIdx).trim();
                const v = line.substring(colonIdx + 1).trim();
                responseHeaders[k] = v;
              }
            });
          }
        } catch (_) {}

        // Parse response body
        let responseBody = null;
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            const txt = this.responseText;
            if (txt && txt.length > 500000) {
              responseBody = txt.substring(0, 500000) + '... (truncated, size > 500KB)';
            } else {
              try {
                responseBody = JSON.parse(txt);
              } catch (_) {
                responseBody = txt;
              }
            }
          } else if (this.responseType === 'json') {
            responseBody = this.response;
          } else {
            responseBody = `[XHR Response type=${this.responseType}]`;
          }
        } catch (e) {
          responseBody = `[Unable to read response: ${e.message}]`;
        }

        emitNetworkEvent({
          requestId,
          associatedActionId,
          initiator: 'xhr',
          method,
          url,
          startTime,
          endTime,
          durationMs,
          status: this.status,
          statusText: this.statusText,
          requestHeaders,
          requestBody,
          responseHeaders,
          responseBody
        });

        // Extend active causality window if applicable
        if (activeCausalityContext && !activeCausalityContext.finalized && activeCausalityContext.actionId === associatedActionId) {
          clearTimeout(causalityTimer);
          causalityTimer = setTimeout(() => {
            if (activeCausalityContext && !activeCausalityContext.finalized) {
              finalizeCausalityContext(activeCausalityContext);
              activeCausalityContext = null;
            }
          }, 500);
        }
      };

      this.addEventListener('load', onComplete, { once: true });
      this.addEventListener('error', () => {
        const endTime = Date.now();
        emitNetworkEvent({
          requestId,
          associatedActionId,
          initiator: 'xhr',
          method,
          url,
          startTime,
          endTime,
          durationMs: Math.max(0, endTime - startTime),
          status: 0,
          statusText: 'Error',
          requestHeaders,
          requestBody,
          responseHeaders: {},
          responseBody: null,
          error: 'XMLHttpRequest network error'
        });
      }, { once: true });

      return originalXHRSend.apply(this, arguments);
    };

    activeListeners.push(() => {
      if (originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
      }
      if (originalXHROpen) {
        XMLHttpRequest.prototype.open = originalXHROpen;
        XMLHttpRequest.prototype.send = originalXHRSend;
        XMLHttpRequest.prototype.setRequestHeader = originalXHRSetRequestHeader;
        originalXHROpen = null;
        originalXHRSend = null;
        originalXHRSetRequestHeader = null;
      }
    });
  }

  // --- Message Protocol with Content Script ---
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || (event.data.source !== 'webicu-content-script' && event.data.source !== 'rrweb-content-script')) {
      return;
    }

    const { action, config } = event.data;

    if (action === 'WEBICU_CMD_PING' || action === 'RRWEB_CMD_PING') {
      window.postMessage({ source: 'webicu-page-inject', action: 'WEBICU_INJECT_READY' }, '*');
      return;
    }

    if (action === 'WEBICU_CMD_START' || action === 'RRWEB_CMD_START') {
      if (!window.rrweb || typeof window.rrweb.record !== 'function') {
        console.error('[WebICU] rrweb recording library is not loaded on page!');
        window.postMessage({
          source: 'webicu-page-inject',
          action: 'WEBICU_ERROR',
          error: 'rrweb library is not loaded'
        }, '*');
        return;
      }

      if (stopRecordingFn) {
        try { stopRecordingFn(); } catch (e) {}
        stopRecordingFn = null;
      }
      activeListeners.forEach(cleanup => cleanup());
      activeListeners = [];

      try {
        isRecorderActive = true;
        layoutShiftSnapshotCount = 0;
        snapshotCount = 1;
        lastCapturedUrl = window.location.href;

        const recordConfig = {
          emit(event) {
            window.postMessage({
              source: 'webicu-page-inject',
              action: 'WEBICU_EVENT',
              event
            }, '*');
          },
          recordCanvas: true,
          collectFonts: true,
          inlineStylesheet: true,
          ...(config || {})
        };

        stopRecordingFn = window.rrweb.record(recordConfig) || null;

        // Setup semantic interaction capturing & progressive snapshot monitoring
        setupInteractionCapturing();

        // Setup zero-permission network traffic interceptor (fetch & XHR proxy)
        setupNetworkCapturing();

        // Emit initial progressive snapshot #1 (baseline)
        setTimeout(() => {
          executeProgressiveSnapshot('INITIAL_LOAD');
        }, 150);

        window.postMessage({
          source: 'webicu-page-inject',
          action: 'WEBICU_STARTED',
          timestamp: Date.now()
        }, '*');
      } catch (err) {
        console.error('[WebICU] Failed to start recording:', err);
        window.postMessage({
          source: 'webicu-page-inject',
          action: 'WEBICU_ERROR',
          error: err.message
        }, '*');
      }
    } else if (action === 'WEBICU_CMD_STOP' || action === 'RRWEB_CMD_STOP') {
      isRecorderActive = false;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (settleMaxTimeout) {
        clearTimeout(settleMaxTimeout);
        settleMaxTimeout = null;
      }

      if (activeCausalityContext) {
        finalizeCausalityContext(activeCausalityContext);
        activeCausalityContext = null;
      }

      activeListeners.forEach(cleanup => {
        try { cleanup(); } catch (e) {}
      });
      activeListeners = [];

      if (stopRecordingFn) {
        try {
          stopRecordingFn();
        } catch (e) {
          console.warn('[WebICU] Error during stopRecordingFn:', e);
        }
        stopRecordingFn = null;
      }

      window.postMessage({
        source: 'webicu-page-inject',
        action: 'WEBICU_STOPPED',
        timestamp: Date.now()
      }, '*');
    }
  });

  window.postMessage({ source: 'webicu-page-inject', action: 'WEBICU_INJECT_READY' }, '*');
})();
