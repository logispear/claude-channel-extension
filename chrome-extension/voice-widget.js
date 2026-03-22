// Voice Widget for Claude Code Extension
(function() {
  // Check if widget already exists in DOM
  if (document.getElementById('claude-voice-widget')) {
    return;
  }

  let widget = null;
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let apiBase = '';
  let pendingElements = [];
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let audioContext = null;
  let analyser = null;
  let silenceTimer = null;
  let audioStream = null;
  let processingPollTimer = null;

  function createWidget() {
    // Double check
    if (document.getElementById('claude-voice-widget')) {
      return;
    }

    widget = document.createElement('div');
    widget.id = 'claude-voice-widget';
    // Set initial position (bottom right, offset for sidepanel ~400px)
    widget.style.bottom = '20px';
    widget.style.right = '20px';
    widget.innerHTML = `
      <div class="claude-voice-main">
        <button class="claude-voice-mic" title="Click to speak">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
        <button class="claude-voice-pick" title="Pick element">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
            <path d="M13 13l6 6"/>
          </svg>
        </button>
        <button class="claude-voice-close" title="Close voice mode">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="claude-voice-elements"></div>
    `;

    document.body.appendChild(widget);

    // Get elements
    const micBtn = widget.querySelector('.claude-voice-mic');
    const pickBtn = widget.querySelector('.claude-voice-pick');
    const closeBtn = widget.querySelector('.claude-voice-close');

    // Mic button click
    micBtn.addEventListener('click', (e) => {
      if (isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });

    // Pick element button
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      activateElementPicker();
    });

    // Close button
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      destroyWidget();
    });

    // Dragging - on the whole widget
    widget.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

  }

  function onMouseDown(e) {
    // Don't drag if clicking on buttons
    if (e.target.closest('.claude-voice-mic') ||
        e.target.closest('.claude-voice-pick') ||
        e.target.closest('.claude-voice-close') ||
        e.target.closest('.claude-voice-element-chip')) {
      return;
    }

    isDragging = true;
    const rect = widget.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Switch from bottom/right to top/left positioning for dragging
    widget.style.top = rect.top + 'px';
    widget.style.left = rect.left + 'px';
    widget.style.bottom = 'auto';
    widget.style.right = 'auto';

    widget.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging || !widget) return;

    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;

    // Keep within viewport
    const maxX = window.innerWidth - widget.offsetWidth;
    const maxY = window.innerHeight - widget.offsetHeight;

    widget.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
    widget.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
  }

  function onMouseUp() {
    if (isDragging) {
      isDragging = false;
      if (widget) widget.style.cursor = '';
    }
  }

  async function startRecording() {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      audioChunks = [];

      // Setup silence detection
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(audioStream);
      source.connect(analyser);
      analyser.fftSize = 512;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let silenceStart = null;
      const SILENCE_THRESHOLD = 10; // Audio level below this is silence
      const SILENCE_DURATION = 1500; // Stop after 1.5s of silence

      function checkSilence() {
        if (!isRecording) return;

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;

        if (average < SILENCE_THRESHOLD) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > SILENCE_DURATION) {
            // Silence detected for long enough, stop recording
            stopRecording();
            return;
          }
        } else {
          silenceStart = null;
        }

        silenceTimer = requestAnimationFrame(checkSilence);
      }

      // Start checking after a short delay (let user start speaking)
      setTimeout(() => {
        if (isRecording) checkSilence();
      }, 500);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Cleanup
        if (silenceTimer) cancelAnimationFrame(silenceTimer);
        if (audioContext) audioContext.close();
        audioStream.getTracks().forEach(track => track.stop());

        if (audioChunks.length === 0) return;

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        await sendAudioToWhisper(audioBlob);
      };

      mediaRecorder.start();
      setRecordingState(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setRecordingState(false);
    }
  }

  function stopRecording() {
    if (silenceTimer) {
      cancelAnimationFrame(silenceTimer);
      silenceTimer = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    setRecordingState(false);
  }

  async function sendAudioToWhisper(audioBlob) {
    setProcessingState(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch(apiBase + '/api/whisper', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Whisper API error:', data.error);
        setProcessingState(false);
        return;
      }

      const transcript = data.text;
      if (transcript && transcript.trim()) {
        sendTranscription(transcript);
        // Keep processing state ON - will be turned off when Claude responds
      } else {
        setProcessingState(false);
      }
    } catch (err) {
      console.error('Whisper error:', err);
      setProcessingState(false);
    }
  }

  function setProcessingState(processing) {
    if (widget) {
      widget.classList.toggle('processing', processing);
    }

    // Manage polling/timeout for processing state
    if (processing) {
      startProcessingCheck();
    } else {
      stopProcessingCheck();
    }
  }

  function startProcessingCheck() {
    stopProcessingCheck();

    // Poll /api/check every 500ms to detect when Claude responds
    processingPollTimer = setInterval(async () => {
      try {
        const res = await fetch(apiBase + '/api/check');
        if (res.ok) {
          const data = await res.json();
          if (data.pending > 0) {
            // Claude has responded, turn off processing
            setProcessingState(false);
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }, 500);

    // Safety timeout after 60 seconds
    setTimeout(() => {
      if (widget && widget.classList.contains('processing')) {
        setProcessingState(false);
      }
    }, 60000);
  }

  function stopProcessingCheck() {
    if (processingPollTimer) {
      clearInterval(processingPollTimer);
      processingPollTimer = null;
    }
  }

  function setRecordingState(recording) {
    isRecording = recording;
    if (widget) {
      widget.classList.toggle('recording', recording);
    }
  }

  function sendTranscription(text) {
    if (!text.trim()) return;

    // Build display text with element references
    let displayText = text;
    if (pendingElements.length > 0) {
      displayText += ' ' + pendingElements.map(() => '#element').join(' ');
    }

    // Build content with elements for backend
    let content = text;
    if (pendingElements.length > 0) {
      const elementParts = pendingElements.map((el, i) =>
        `[Element ${i + 1}]\nPage: ${window.location.href}\nSelector: ${el.selector}\nHTML:\n${el.html}`
      );
      content = content + '\n\nSelected elements:\n\n' + elementParts.join('\n\n');
    }

    // Save to pending messages queue (for when sidepanel is closed)
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = { sender: 'user', text: displayText, time: timeStr, images: [] };

    chrome.storage.local.get('pendingVoiceMessages', (data) => {
      const pending = data.pendingVoiceMessages || [];
      pending.push(msg);
      chrome.storage.local.set({ pendingVoiceMessages: pending });
    });

    // Send directly to backend
    fetch(apiBase + '/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content, images: [] }),
    }).then(() => {
      console.log('Voice message sent');
    }).catch((err) => {
      console.error('Failed to send voice message:', err);
    });

    // Notify sidepanel if open
    try {
      chrome.runtime.sendMessage({
        type: 'VOICE_TRANSCRIPTION',
        text: text,
        elements: pendingElements.map(el => ({
          html: el.html,
          selector: el.selector,
          pageUrl: window.location.href
        }))
      }, () => {
        if (chrome.runtime.lastError) {
          // Sidepanel closed, message already saved to storage
        }
      });
    } catch (e) {}

    // Clear pending elements
    pendingElements = [];
    updateElementsDisplay();
  }

  function activateElementPicker() {
    let pickerOverlay = document.getElementById('claude-picker-overlay');
    if (!pickerOverlay) {
      pickerOverlay = document.createElement('div');
      pickerOverlay.id = 'claude-picker-overlay';
      document.body.appendChild(pickerOverlay);
    }

    let highlightedEl = null;

    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== pickerOverlay && el !== widget && !widget.contains(el)) {
        highlightedEl = el;
        const rect = el.getBoundingClientRect();
        pickerOverlay.style.top = (rect.top + window.scrollY) + 'px';
        pickerOverlay.style.left = (rect.left + window.scrollX) + 'px';
        pickerOverlay.style.width = rect.width + 'px';
        pickerOverlay.style.height = rect.height + 'px';
        pickerOverlay.style.display = 'block';
      }
    };

    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (highlightedEl && !widget.contains(highlightedEl)) {
        pendingElements.push({
          html: highlightedEl.outerHTML,
          selector: getSelector(highlightedEl),
          label: getLabel(highlightedEl)
        });
        updateElementsDisplay();
        cleanup();
        // Auto-start recording after picking element
        setTimeout(() => startRecording(), 100);
      } else {
        cleanup();
      }
    };

    const onKey = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('claude-picker-active');
      if (pickerOverlay) pickerOverlay.style.display = 'none';
    };

    document.body.classList.add('claude-picker-active');
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift('#' + CSS.escape(current.id));
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className.trim().split(/\s+/).filter(c => c)[0];
        if (cls) selector += '.' + CSS.escape(cls);
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  function getLabel(el) {
    let label = el.tagName.toLowerCase();
    if (el.id) {
      label += '#' + el.id;
    } else if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/)[0];
      if (cls) label += '.' + cls;
    }
    return '<' + (label.length > 20 ? label.slice(0,17) + '...' : label) + '>';
  }

  function updateElementsDisplay() {
    if (!widget) return;
    const container = widget.querySelector('.claude-voice-elements');
    if (!container) return;
    container.innerHTML = '';
    pendingElements.forEach((el, i) => {
      const chip = document.createElement('div');
      chip.className = 'claude-voice-element-chip';
      chip.innerHTML = `<span>${el.label}</span><button>&times;</button>`;
      chip.querySelector('button').onclick = (e) => {
        e.stopPropagation();
        pendingElements.splice(i, 1);
        updateElementsDisplay();
      };
      container.appendChild(chip);
    });
  }

  function destroyWidget() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    stopProcessingCheck();
    if (silenceTimer) {
      cancelAnimationFrame(silenceTimer);
      silenceTimer = null;
    }
    if (audioContext) {
      try { audioContext.close(); } catch(e) {}
      audioContext = null;
    }
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
    if (widget) {
      widget.remove();
      widget = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch(e) {}
    }
    mediaRecorder = null;
  }

  // Listen for messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ACTIVATE_VOICE_MODE') {
      apiBase = msg.apiBase;
      if (!document.getElementById('claude-voice-widget')) {
        createWidget();
      }
      sendResponse({ success: true });
    } else if (msg.type === 'DEACTIVATE_VOICE_MODE') {
      destroyWidget();
      sendResponse({ success: true });
    } else if (msg.type === 'CLAUDE_RESPONDED') {
      // Claude finished responding, turn off processing state
      setProcessingState(false);
      sendResponse({ success: true });
    }
    return true;
  });

  // Auto-create if apiBase already set
  if (typeof apiBase !== 'undefined' && apiBase) {
    createWidget();
  }
})();
