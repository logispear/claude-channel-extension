// Element Picker for Claude Code Extension
(function() {
  // Prevent multiple initializations
  if (window.__claudePickerInitialized) return;
  window.__claudePickerInitialized = true;

  let isActive = false;
  let highlightedEl = null;
  let overlay = null;

  // Generate a unique CSS selector for an element
  function getSelector(el) {
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }

    const path = [];
    let current = el;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c);
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // Get a short label for the element
  function getLabel(el) {
    let label = el.tagName.toLowerCase();
    if (el.id) {
      label += '#' + el.id;
    } else if (el.className && typeof el.className === 'string') {
      const firstClass = el.className.trim().split(/\s+/)[0];
      if (firstClass) {
        label += '.' + firstClass;
      }
    }
    // Truncate if too long
    if (label.length > 30) {
      label = label.substring(0, 27) + '...';
    }
    return '<' + label + '>';
  }

  // Create highlight overlay
  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'claude-picker-overlay';
    document.body.appendChild(overlay);
  }

  // Update highlight position
  function updateHighlight(el) {
    if (!el || !overlay) return;
    const rect = el.getBoundingClientRect();
    overlay.style.top = (rect.top + window.scrollY) + 'px';
    overlay.style.left = (rect.left + window.scrollX) + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
  }

  // Clear highlight
  function clearHighlight() {
    if (overlay) {
      overlay.style.display = 'none';
    }
    highlightedEl = null;
  }

  // Mouse move handler
  function onMouseMove(e) {
    if (!isActive) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== overlay && el !== highlightedEl) {
      highlightedEl = el;
      updateHighlight(el);
    }
  }

  // Click handler
  function onClick(e) {
    if (!isActive) return;

    e.preventDefault();
    e.stopPropagation();

    if (highlightedEl && highlightedEl !== overlay) {
      const elementData = {
        html: highlightedEl.outerHTML,
        selector: getSelector(highlightedEl),
        label: getLabel(highlightedEl)
      };

      // Send to extension
      chrome.runtime.sendMessage({
        type: 'ELEMENT_PICKED',
        data: elementData
      });

      deactivatePicker();
    }
  }

  // Keyboard handler
  function onKeyDown(e) {
    if (!isActive) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      deactivatePicker();
      chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' });
    }
  }

  // Activate picker mode
  function activatePicker() {
    if (isActive) return;
    isActive = true;

    createOverlay();
    document.body.classList.add('claude-picker-active');

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // Deactivate picker mode
  function deactivatePicker() {
    if (!isActive) return;
    isActive = false;

    clearHighlight();
    document.body.classList.remove('claude-picker-active');

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  // Listen for messages from the side panel
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ACTIVATE_PICKER') {
      activatePicker();
      sendResponse({ success: true });
    } else if (msg.type === 'DEACTIVATE_PICKER') {
      deactivatePicker();
      sendResponse({ success: true });
    }
    return true;
  });
})();
