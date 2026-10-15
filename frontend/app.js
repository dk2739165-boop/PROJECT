/**
 * Nexus Gemini Chatbot — Frontend Client Logic (with Supabase Persistence)
 * 
 * Clear Separation Notice:
 * - This file runs ONLY in the browser client.
 * - It never makes direct secret calls to Google Cloud or Supabase Service Role.
 * - All generative requests and database operations are proxied through our Node.js backend.
 */

// -----------------------------------------------------------------------------
// Configuration & State
// -----------------------------------------------------------------------------

const BACKEND_BASE = (window.location.protocol.startsWith('http') && window.location.port === '5000') 
  ? '' 
  : 'http://localhost:5000';

const state = {
  conversation: [],         // Array of { role: 'user' | 'model', content: string }
  isGenerating: false,
  selectedModel: 'gemini-2.5-flash',
  activeSessionId: null,    // Supabase conversation UUID
  sessions: [],             // Array of Supabase chat sessions
  hasBackendKey: false,
  hasSupabase: false,
  backendConnected: false,
  apiKeyOverride: localStorage.getItem('nexus_gemini_key') || '',
  systemInstruction: localStorage.getItem('nexus_gemini_instruction') || '',
  supabaseUrlOverride: localStorage.getItem('nexus_supabase_url') || '',
  supabaseKeyOverride: localStorage.getItem('nexus_supabase_key') || ''
};

// DOM References
const elements = {
  messagesContainer: document.getElementById('messages-container'),
  welcomeHero: document.getElementById('welcome-hero'),
  typingIndicator: document.getElementById('typing-indicator'),
  chatForm: document.getElementById('chat-form'),
  userInput: document.getElementById('user-input'),
  sendBtn: document.getElementById('send-btn'),
  clearChatBtn: document.getElementById('clear-chat-btn'),
  modelSelect: document.getElementById('model-select'),
  keyStatusIndicator: document.getElementById('key-status-indicator'),
  backendStatusText: document.getElementById('backend-status-text'),
  
  // Sidebar & Sessions
  sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
  chatSidebar: document.getElementById('chat-sidebar'),
  newChatBtn: document.getElementById('new-chat-btn'),
  sessionsList: document.getElementById('sessions-list'),
  emptySessionsHint: document.getElementById('empty-sessions-hint'),
  sidebarDbBadge: document.getElementById('sidebar-db-badge'),
  footerDbDot: document.getElementById('footer-db-dot'),
  footerDbText: document.getElementById('footer-db-text'),

  // Architecture Modal
  archModalBtn: document.getElementById('arch-modal-btn'),
  archModal: document.getElementById('arch-modal'),
  
  // Settings Modal
  settingsModalBtn: document.getElementById('settings-modal-btn'),
  settingsModal: document.getElementById('settings-modal'),
  serverDot: document.getElementById('server-dot'),
  serverStatusTitle: document.getElementById('server-status-title'),
  serverStatusDesc: document.getElementById('server-status-desc'),
  supabaseDot: document.getElementById('supabase-dot'),
  supabaseStatusTitle: document.getElementById('supabase-status-title'),
  supabaseStatusDesc: document.getElementById('supabase-status-desc'),
  refreshStatusBtn: document.getElementById('refresh-status-btn'),
  overrideApiKeyInput: document.getElementById('override-api-key'),
  toggleKeyVisibilityBtn: document.getElementById('toggle-key-visibility'),
  systemInstructionInput: document.getElementById('system-instruction'),
  supabaseUrlInput: document.getElementById('supabase-url-input'),
  supabaseKeyInput: document.getElementById('supabase-key-input'),
  saveSettingsBtn: document.getElementById('save-settings-btn'),
  clearKeyBtn: document.getElementById('clear-key-btn')
};

// -----------------------------------------------------------------------------
// Markdown & Syntax Highlighting Setup
// -----------------------------------------------------------------------------

if (window.marked) {
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
      if (window.hljs) {
        const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language: validLang }).value;
      }
      return code;
    }
  });
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  initSettingsForm();
  checkBackendHealth();
});

function initEventListeners() {
  // Input auto-expand and submit validation
  elements.userInput.addEventListener('input', () => {
    autoResizeInput();
    elements.sendBtn.disabled = !elements.userInput.value.trim() || state.isGenerating;
  });

  // Keydown (Enter to send, Shift+Enter for new line)
  elements.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!elements.sendBtn.disabled) {
        elements.chatForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  // Form submission
  elements.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = elements.userInput.value.trim();
    if (!prompt || state.isGenerating) return;
    sendMessage(prompt);
  });

  // Sidebar toggle
  elements.sidebarToggleBtn.addEventListener('click', () => {
    elements.chatSidebar.classList.toggle('collapsed');
  });

  // New Chat button
  elements.newChatBtn.addEventListener('click', startNewChat);

  // Clear chat
  elements.clearChatBtn.addEventListener('click', () => {
    if (state.conversation.length === 0) return;
    if (confirm('Clear the current chat messages from the screen?')) {
      resetChatView();
    }
  });

  // Model selection
  elements.modelSelect.addEventListener('change', (e) => {
    state.selectedModel = e.target.value;
  });

  // Quick prompt chips
  document.querySelectorAll('.prompt-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt) {
        elements.userInput.value = prompt;
        autoResizeInput();
        elements.sendBtn.disabled = false;
        sendMessage(prompt);
      }
    });
  });

  // Modal triggers
  elements.archModalBtn.addEventListener('click', () => openModal(elements.archModal));
  elements.settingsModalBtn.addEventListener('click', () => {
    checkBackendHealth();
    openModal(elements.settingsModal);
  });

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      const targetModal = document.getElementById(modalId);
      if (targetModal) closeModal(targetModal);
    });
  });

  // Close modals on overlay backdrop click
  [elements.archModal, elements.settingsModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // Settings: Toggle password visibility
  elements.toggleKeyVisibilityBtn.addEventListener('click', () => {
    const isPassword = elements.overrideApiKeyInput.type === 'password';
    elements.overrideApiKeyInput.type = isPassword ? 'text' : 'password';
  });

  // Settings: Save button
  elements.saveSettingsBtn.addEventListener('click', saveSettings);

  // Settings: Clear stored key button
  elements.clearKeyBtn.addEventListener('click', () => {
    localStorage.removeItem('nexus_gemini_key');
    localStorage.removeItem('nexus_gemini_instruction');
    localStorage.removeItem('nexus_supabase_url');
    localStorage.removeItem('nexus_supabase_key');
    state.apiKeyOverride = '';
    state.systemInstruction = '';
    state.supabaseUrlOverride = '';
    state.supabaseKeyOverride = '';
    elements.overrideApiKeyInput.value = '';
    elements.systemInstructionInput.value = '';
    elements.supabaseUrlInput.value = '';
    elements.supabaseKeyInput.value = '';
    updateStatusIndicators();
    alert('Cleared local overrides. Backend will use backend/.env values.');
  });

  // Settings: Manual refresh button
  elements.refreshStatusBtn.addEventListener('click', checkBackendHealth);
}

function initSettingsForm() {
  if (state.apiKeyOverride) elements.overrideApiKeyInput.value = state.apiKeyOverride;
  if (state.systemInstruction) elements.systemInstructionInput.value = state.systemInstruction;
  if (state.supabaseUrlOverride) elements.supabaseUrlInput.value = state.supabaseUrlOverride;
  if (state.supabaseKeyOverride) elements.supabaseKeyInput.value = state.supabaseKeyOverride;
}

function autoResizeInput() {
  const input = elements.userInput;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}

function openModal(modal) {
  modal.style.display = 'flex';
}

function closeModal(modal) {
  modal.style.display = 'none';
}

// -----------------------------------------------------------------------------
// Backend Status & Supabase Health Checks
// -----------------------------------------------------------------------------

async function checkBackendHealth() {
  elements.backendStatusText.textContent = 'Backend: Checking...';
  
  try {
    const res = await fetch(`${BACKEND_BASE}/api/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    state.backendConnected = true;
    state.hasBackendKey = data.hasApiKey;
    state.hasSupabase = data.hasSupabase || !!(state.supabaseUrlOverride && state.supabaseKeyOverride);

    // Update Server Card
    elements.serverDot.className = 'status-indicator-lg online';
    elements.serverStatusTitle.textContent = 'Backend Online';
    elements.serverStatusDesc.textContent = `Server on port 5000 • Gemini Key: ${data.hasApiKey ? 'Ready in .env' : 'Missing'}`;

    // Update Supabase Card
    if (state.hasSupabase) {
      elements.supabaseDot.className = 'status-indicator-lg online';
      elements.supabaseStatusTitle.textContent = 'Supabase Connected';
      elements.supabaseStatusDesc.textContent = 'PostgreSQL active (chat_sessions & chat_messages)';
      elements.sidebarDbBadge.textContent = 'Supabase Connected';
      elements.sidebarDbBadge.style.color = '#3ecf8e';
      elements.footerDbDot.className = 'tag-dot online';
      elements.footerDbText.textContent = 'Supabase: Connected';
      loadSessions();
    } else {
      elements.supabaseDot.className = 'status-indicator-lg';
      elements.supabaseStatusTitle.textContent = 'Supabase Disconnected';
      elements.supabaseStatusDesc.textContent = 'Add SUPABASE_URL & ANON_KEY to enable database';
      elements.sidebarDbBadge.textContent = 'Local / In-Memory';
      elements.sidebarDbBadge.style.color = '#8e9bb8';
      elements.footerDbDot.className = 'tag-dot';
      elements.footerDbText.textContent = 'Supabase: Inactive (Set .env)';
    }
    
    elements.backendStatusText.innerHTML = `Backend: <span style="color:#10b981;">Online</span> &bull; Key: ${
      (state.hasBackendKey || state.apiKeyOverride) 
        ? '<span style="color:#10b981;">Ready</span>' 
        : '<span style="color:#f59e0b;">Missing (Click ⚙️)</span>'
    } &bull; DB: ${state.hasSupabase ? '<span style="color:#3ecf8e;">Supabase</span>' : 'Local'}`;

    updateStatusIndicators();
  } catch (err) {
    state.backendConnected = false;
    elements.serverDot.className = 'status-indicator-lg offline';
    elements.serverStatusTitle.textContent = 'Backend Offline';
    elements.serverStatusDesc.textContent = `Cannot reach ${BACKEND_BASE || window.location.origin}. Run "npm start" in root.`;
    
    elements.supabaseDot.className = 'status-indicator-lg offline';
    elements.supabaseStatusTitle.textContent = 'Backend Offline';
    elements.supabaseStatusDesc.textContent = 'Start backend to connect database';

    elements.backendStatusText.innerHTML = `Backend: <span style="color:#ef4444;">Offline</span> (Port 5000)`;
    elements.keyStatusIndicator.className = 'status-dot offline';
    elements.footerDbDot.className = 'tag-dot';
    elements.footerDbText.textContent = 'Supabase: Offline';
  }
}

function updateStatusIndicators() {
  const hasKey = state.hasBackendKey || !!state.apiKeyOverride;
  if (!state.backendConnected) {
    elements.keyStatusIndicator.className = 'status-dot offline';
  } else if (hasKey) {
    elements.keyStatusIndicator.className = 'status-dot online';
  } else {
    elements.keyStatusIndicator.className = 'status-dot';
  }
}

function saveSettings() {
  const newKey = elements.overrideApiKeyInput.value.trim();
  const newInstruction = elements.systemInstructionInput.value.trim();
  const newDbUrl = elements.supabaseUrlInput.value.trim();
  const newDbKey = elements.supabaseKeyInput.value.trim();

  state.apiKeyOverride = newKey;
  state.systemInstruction = newInstruction;
  state.supabaseUrlOverride = newDbUrl;
  state.supabaseKeyOverride = newDbKey;

  if (newKey) localStorage.setItem('nexus_gemini_key', newKey);
  else localStorage.removeItem('nexus_gemini_key');

  if (newInstruction) localStorage.setItem('nexus_gemini_instruction', newInstruction);
  else localStorage.removeItem('nexus_gemini_instruction');

  if (newDbUrl) localStorage.setItem('nexus_supabase_url', newDbUrl);
  else localStorage.removeItem('nexus_supabase_url');

  if (newDbKey) localStorage.setItem('nexus_supabase_key', newDbKey);
  else localStorage.removeItem('nexus_supabase_key');

  updateStatusIndicators();
  checkBackendHealth();
  closeModal(elements.settingsModal);
}

// -----------------------------------------------------------------------------
// Supabase Session Management (Frontend)
// -----------------------------------------------------------------------------

async function loadSessions() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/sessions`);
    if (!res.ok) return;
    const data = await res.json();
    state.sessions = data.sessions || [];
    renderSessionsList();
  } catch (err) {
    console.warn('Failed to load sessions from Supabase:', err);
  }
}

function renderSessionsList() {
  const list = elements.sessionsList;
  list.innerHTML = '';

  if (state.sessions.length === 0) {
    elements.emptySessionsHint.style.display = 'block';
    list.appendChild(elements.emptySessionsHint);
    return;
  }

  elements.emptySessionsHint.style.display = 'none';

  state.sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item ${session.id === state.activeSessionId ? 'active' : ''}`;
    item.dataset.id = session.id;

    const timeAgo = formatRelativeTime(session.updated_at || session.created_at);

    item.innerHTML = `
      <div class="session-title-wrap">
        <span class="session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</span>
        <span class="session-time">${timeAgo}</span>
      </div>
      <button class="delete-session-btn" title="Delete conversation" data-delete-id="${session.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    // Click on session to load it
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-session-btn')) return;
      loadSessionMessages(session.id);
    });

    // Delete session
    const deleteBtn = item.querySelector('.delete-session-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this conversation from Supabase?')) {
        await deleteSession(session.id);
      }
    });

    list.appendChild(item);
  });
}

async function loadSessionMessages(sessionId) {
  if (state.isGenerating) return;
  state.activeSessionId = sessionId;
  renderSessionsList(); // update active class

  try {
    const res = await fetch(`${BACKEND_BASE}/api/sessions/${sessionId}/messages`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const messages = data.messages || [];

    // Reset current view and conversation array
    state.conversation = [];
    elements.messagesContainer.innerHTML = '';
    if (elements.welcomeHero) elements.welcomeHero.style.display = 'none';

    messages.forEach(msg => {
      const sender = msg.role === 'model' || msg.role === 'assistant' ? 'gemini' : 'user';
      appendMessage(sender, msg.content);
      state.conversation.push({ role: msg.role, content: msg.content });
    });

    scrollToBottom();
  } catch (err) {
    console.error('Error loading session messages:', err);
  }
}

async function deleteSession(sessionId) {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    if (state.activeSessionId === sessionId) {
      startNewChat();
    } else {
      renderSessionsList();
    }
  } catch (err) {
    console.error('Error deleting session:', err);
  }
}

function startNewChat() {
  state.activeSessionId = null;
  state.conversation = [];
  resetChatView();
  renderSessionsList();
}

function resetChatView() {
  elements.messagesContainer.innerHTML = '';
  if (elements.welcomeHero) {
    elements.welcomeHero.style.display = 'flex';
    elements.messagesContainer.appendChild(elements.welcomeHero);
  }
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// -----------------------------------------------------------------------------
// Chat & Messaging Operations (Decoupled API Invocation)
// -----------------------------------------------------------------------------

async function sendMessage(text) {
  if (elements.welcomeHero) {
    elements.welcomeHero.style.display = 'none';
  }

  appendMessage('user', text);
  state.conversation.push({ role: 'user', content: text });

  elements.userInput.value = '';
  autoResizeInput();
  elements.sendBtn.disabled = true;
  state.isGenerating = true;

  elements.typingIndicator.style.display = 'flex';
  scrollToBottom();

  const payload = {
    message: text,
    history: state.conversation.slice(0, -1),
    model: state.selectedModel,
    systemInstruction: state.systemInstruction,
    sessionId: state.activeSessionId
  };

  const headers = { 'Content-Type': 'application/json' };
  if (state.apiKeyOverride) {
    headers['x-gemini-api-key'] = state.apiKeyOverride;
  }

  try {
    await fetchStreamingResponse(payload, headers);
  } catch (streamErr) {
    console.warn('Streaming issue, trying fallback JSON API:', streamErr);
    try {
      await fetchJsonResponse(payload, headers);
    } catch (fallbackErr) {
      handleChatError(fallbackErr);
    }
  } finally {
    state.isGenerating = false;
    elements.typingIndicator.style.display = 'none';
    elements.sendBtn.disabled = !elements.userInput.value.trim();
    elements.userInput.focus();
    if (state.hasSupabase) {
      loadSessions(); // refresh session list with updated timestamps / newly created session
    }
  }
}

/**
 * Server-Sent Events (SSE) Streaming
 */
async function fetchStreamingResponse(payload, headers) {
  const response = await fetch(`${BACKEND_BASE}/api/chat/stream`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errMessage = `Server returned HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) errMessage = errJson.error;
    } catch (_) {}
    throw new Error(errMessage);
  }

  elements.typingIndicator.style.display = 'none';
  const { bubbleElement, updateContent } = createStreamingMessageElement();
  
  let fullReply = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const block of lines) {
      const trimmed = block.trim();
      if (!trimmed.startsWith('data:')) continue;
      
      const dataStr = trimmed.replace(/^data:\s*/, '');
      if (dataStr === '[DONE]') break;

      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.sessionId && !state.activeSessionId) {
          state.activeSessionId = parsed.sessionId;
        }
        if (parsed.chunk) {
          fullReply += parsed.chunk;
          updateContent(fullReply);
          scrollToBottom();
        }
      } catch (e) {
        if (e.message !== 'Unexpected end of JSON input') {
          console.error('Error parsing SSE data:', e);
        }
      }
    }
  }

  if (fullReply.trim()) {
    state.conversation.push({ role: 'model', content: fullReply });
    enhanceCodeBlocks(bubbleElement);
  } else {
    throw new Error('Empty response received from backend stream.');
  }
}

/**
 * Standard REST API Fallback
 */
async function fetchJsonResponse(payload, headers) {
  const response = await fetch(`${BACKEND_BASE}/api/chat`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}: Failed to get response`);
  }

  if (data.sessionId && !state.activeSessionId) {
    state.activeSessionId = data.sessionId;
  }

  appendMessage('gemini', data.reply);
  state.conversation.push({ role: 'model', content: data.reply });
}

function handleChatError(error) {
  console.error('[Chat Error]:', error);
  const isKeyIssue = error.message.includes('API_KEY') || error.message.includes('Key is not configured');

  let errorHtml = `
    <div style="color: #f87171; font-weight: 500;">
      ⚠️ <strong>Error:</strong> ${escapeHtml(error.message)}
    </div>
  `;

  if (isKeyIssue) {
    errorHtml += `
      <div style="margin-top: 8px; font-size: 0.85rem; color: #cbd5e1;">
        💡 <strong>Quick Fix:</strong> Click the <strong>⚙️ Settings button</strong> in the top header to enter your Gemini API key, or place it into <code>backend/.env</code>.
      </div>
    `;
  }

  appendRawMessage('gemini', errorHtml);
}

// -----------------------------------------------------------------------------
// Message Rendering & UI Helpers
// -----------------------------------------------------------------------------

function appendMessage(sender, text) {
  const row = document.createElement('div');
  row.className = `message-row ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = sender === 'user' ? 'You' : `
    <svg viewBox="0 0 24 24" fill="none" style="width:18px;height:18px;">
      <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" fill="url(#sparkle-msg)"/>
      <defs>
        <linearGradient id="sparkle-msg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stop-color="#4E80EE"/>
          <stop offset="0.5" stop-color="#8F54FB"/>
          <stop offset="1" stop-color="#EA5297"/>
        </linearGradient>
      </defs>
    </svg>
  `;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (sender === 'user') {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = window.marked ? marked.parse(text) : escapeHtml(text);
    enhanceCodeBlocks(bubble);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `
      <span>${state.selectedModel}</span> &bull; 
      <span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> &bull;
      <button class="copy-msg-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      </button>
    `;

    meta.querySelector('.copy-msg-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      const btn = meta.querySelector('.copy-msg-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg> Copy
        `;
      }, 1800);
    });

    bubble.appendChild(meta);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  elements.messagesContainer.appendChild(row);
  scrollToBottom();
}

function appendRawMessage(sender, rawHtml) {
  const row = document.createElement('div');
  row.className = `message-row ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = sender === 'user' ? 'You' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = rawHtml;

  row.appendChild(avatar);
  row.appendChild(bubble);
  elements.messagesContainer.appendChild(row);
  scrollToBottom();
}

function createStreamingMessageElement() {
  const row = document.createElement('div');
  row.className = 'message-row gemini';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" style="width:18px;height:18px;">
      <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" fill="url(#sparkle-msg2)"/>
      <defs>
        <linearGradient id="sparkle-msg2" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stop-color="#4E80EE"/>
          <stop offset="0.5" stop-color="#8F54FB"/>
          <stop offset="1" stop-color="#EA5297"/>
        </linearGradient>
      </defs>
    </svg>
  `;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = '<span style="color:var(--text-dim);">Generating response...</span>';

  row.appendChild(avatar);
  row.appendChild(bubble);
  elements.messagesContainer.appendChild(row);

  return {
    bubbleElement: bubble,
    updateContent: (newText) => {
      bubble.innerHTML = window.marked ? marked.parse(newText) : escapeHtml(newText);
    }
  };
}

function enhanceCodeBlocks(container) {
  const pres = container.querySelectorAll('pre');
  pres.forEach(pre => {
    if (pre.previousElementSibling && pre.previousElementSibling.classList.contains('code-header')) {
      return;
    }

    const code = pre.querySelector('code');
    let lang = 'code';
    if (code && code.className) {
      const match = code.className.match(/language-([a-z0-9_-]+)/i);
      if (match) lang = match[1];
    }

    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `
      <span>${lang}</span>
      <button class="copy-code-btn">Copy code</button>
    `;

    const copyBtn = header.querySelector('.copy-code-btn');
    copyBtn.addEventListener('click', () => {
      const textToCopy = code ? code.innerText : pre.innerText;
      navigator.clipboard.writeText(textToCopy);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 2000);
    });

    pre.parentNode.insertBefore(header, pre);
  });
}

function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function escapeHtml(string) {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(string).replace(/[&<>"']/g, s => entityMap[s]);
}
