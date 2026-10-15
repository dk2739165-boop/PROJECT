/**
 * Gemini Chatbot Backend Server with Supabase Persistence
 * 
 * Demonstrates clean separation of concerns:
 * - Backend manages secrets (GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, etc.)
 * - Backend connects to Supabase database for persistent chat sessions & message logs.
 * - Frontend communicates via REST/SSE endpoints over HTTP and can also use public Supabase client.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, '.env') });

const { generateChatResponse, streamChatResponse } = require('./geminiService');
const supabaseService = require('./supabaseService');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so the frontend can run independently or on different dev ports
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-gemini-api-key']
}));

app.use(express.json({ limit: '1mb' }));

// Serve frontend static assets directly from ../frontend
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// -----------------------------------------------------------------------------
// System & Configuration Routes
// -----------------------------------------------------------------------------

/**
 * Health & Configuration Status Check
 */
app.get('/api/status', (req, res) => {
  const hasEnvKey = !!(
    process.env.GEMINI_API_KEY && 
    process.env.GEMINI_API_KEY.trim() !== '' && 
    process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE'
  );

  res.json({
    status: 'online',
    hasApiKey: hasEnvKey,
    hasSupabase: supabaseService.isConfigured(),
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-2.5-flash',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * Public Client Config Endpoint
 * Safely shares public non-secret configuration (Supabase URL & Anon Key)
 */
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    hasSupabase: supabaseService.isConfigured()
  });
});

/**
 * Available Gemini Models
 */
app.get('/api/models', (req, res) => {
  res.json({
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: 'Ultra Fast', description: 'Recommended for instant, intelligent chat responses.' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', badge: 'Advanced Reasoning', description: 'Ideal for complex problem solving, coding, and analysis.' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', badge: 'Legacy Fast', description: 'High-speed multimodal lightweight model.' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', badge: 'Legacy Pro', description: 'Large context window reasoning model.' }
    ]
  });
});

// -----------------------------------------------------------------------------
// Supabase Session Management Routes
// -----------------------------------------------------------------------------

/**
 * List all saved chat sessions from Supabase
 */
app.get('/api/sessions', async (req, res) => {
  if (!supabaseService.isConfigured()) {
    return res.json({ sessions: [], message: 'Supabase is not configured' });
  }

  try {
    const sessions = await supabaseService.getSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create a new chat session in Supabase
 */
app.post('/api/sessions', async (req, res) => {
  if (!supabaseService.isConfigured()) {
    return res.status(503).json({ error: 'Supabase database is not configured' });
  }

  const { title, model } = req.body;
  try {
    const session = await supabaseService.createSession({
      title: title || 'New Conversation',
      model: model || process.env.DEFAULT_MODEL || 'gemini-2.5-flash'
    });
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Fetch messages for a specific session
 */
app.get('/api/sessions/:id/messages', async (req, res) => {
  if (!supabaseService.isConfigured()) {
    return res.status(503).json({ error: 'Supabase database is not configured' });
  }

  const { id } = req.params;
  try {
    const messages = await supabaseService.getMessages(id);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a session and its message logs
 */
app.delete('/api/sessions/:id', async (req, res) => {
  if (!supabaseService.isConfigured()) {
    return res.status(503).json({ error: 'Supabase database is not configured' });
  }

  const { id } = req.params;
  try {
    await supabaseService.deleteSession(id);
    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// Gemini LLM Chat Routes (with Supabase auto-persistence)
// -----------------------------------------------------------------------------

/**
 * Standard JSON Chat Endpoint (Request / Response)
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
  let { message, history, model, systemInstruction, sessionId } = req.body;
  const apiKeyOverride = req.headers['x-gemini-api-key'];

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Field "message" is required and cannot be empty.' });
  }

  const chosenModel = model || process.env.DEFAULT_MODEL || 'gemini-2.5-flash';

  try {
    // If Supabase is active, ensure session exists and persist user message
    if (supabaseService.isConfigured()) {
      if (!sessionId) {
        const title = message.slice(0, 40) + (message.length > 40 ? '...' : '');
        const newSession = await supabaseService.createSession({ title, model: chosenModel });
        if (newSession) sessionId = newSession.id;
      }
      if (sessionId) {
        await supabaseService.saveMessage({
          sessionId,
          role: 'user',
          content: message.trim(),
          model: chosenModel
        });
      }
    }

    const result = await generateChatResponse({
      message: message.trim(),
      history: Array.isArray(history) ? history : [],
      model: chosenModel,
      systemInstruction,
      apiKeyOverride
    });

    // Persist Gemini response to Supabase
    if (supabaseService.isConfigured() && sessionId) {
      await supabaseService.saveMessage({
        sessionId,
        role: 'model',
        content: result.text,
        model: chosenModel
      });
    }

    res.json({
      reply: result.text,
      model: result.model,
      usage: result.usage,
      sessionId: sessionId || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: error.message || 'Failed to generate response from Gemini.'
    });
  }
});

/**
 * Real-time Streaming Chat Endpoint (Server-Sent Events)
 * POST /api/chat/stream
 */
app.post('/api/chat/stream', async (req, res) => {
  let { message, history, model, systemInstruction, sessionId } = req.body;
  const apiKeyOverride = req.headers['x-gemini-api-key'];

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Field "message" is required and cannot be empty.' });
  }

  const chosenModel = model || process.env.DEFAULT_MODEL || 'gemini-2.5-flash';

  // If Supabase is configured, create session if needed & persist user message
  if (supabaseService.isConfigured()) {
    try {
      if (!sessionId) {
        const title = message.slice(0, 40) + (message.length > 40 ? '...' : '');
        const newSession = await supabaseService.createSession({ title, model: chosenModel });
        if (newSession) sessionId = newSession.id;
      }
      if (sessionId) {
        await supabaseService.saveMessage({
          sessionId,
          role: 'user',
          content: message.trim(),
          model: chosenModel
        });
      }
    } catch (dbErr) {
      console.warn('[Supabase auto-save warning]:', dbErr.message);
    }
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let accumulatedReply = '';

  try {
    // Send session ID metadata first
    if (sessionId) {
      res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);
    }

    await streamChatResponse({
      message: message.trim(),
      history: Array.isArray(history) ? history : [],
      model: chosenModel,
      systemInstruction,
      apiKeyOverride,
      onChunk: (chunk) => {
        accumulatedReply += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      },
      onComplete: async () => {
        // Persist accumulated reply to Supabase
        if (supabaseService.isConfigured() && sessionId && accumulatedReply) {
          try {
            await supabaseService.saveMessage({
              sessionId,
              role: 'model',
              content: accumulatedReply,
              model: chosenModel
            });
          } catch (saveErr) {
            console.error('[Supabase async save error]:', saveErr.message);
          }
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
      }
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * Architecture Blueprint Route
 */
app.get('/api/architecture', (req, res) => {
  res.json({
    architecture: 'Decoupled Client-Server Proxy Pattern with Supabase Database',
    frontend: {
      location: '/frontend',
      technologies: ['HTML5', 'Vanilla CSS3', 'JavaScript ES6'],
      envVariables: ['BACKEND_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
      responsibilities: [
        'User interface & event listeners',
        'Markdown parsing & syntax highlighting',
        'Session history drawer & conversation switching',
        'Communicates exclusively with /api/* routes or public Supabase'
      ],
      security: 'Never stores or references private Google API or Supabase Service Role credentials.'
    },
    backend: {
      location: '/backend',
      technologies: ['Node.js', 'Express', '@google/genai SDK', '@supabase/supabase-js', 'dotenv'],
      envVariables: [
        'GEMINI_API_KEY',
        'PORT',
        'DEFAULT_MODEL',
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY'
      ],
      responsibilities: [
        'Secure API credential management via .env',
        'Supabase PostgreSQL persistence (chat_sessions, chat_messages)',
        'Data validation & message structuring for Gemini format',
        'Communicating with Google Gemini Cloud endpoints',
        'SSE streaming and error normalization'
      ],
      security: 'Isolates GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY completely from the browser.'
    },
    database: {
      provider: 'Supabase (PostgreSQL)',
      tables: ['chat_sessions', 'chat_messages'],
      features: ['Row Level Security (RLS)', 'Automatic timestamps', 'Foreign key cascades']
    }
  });
});

// Fallback route: serve frontend index.html for single-page routing
app.use((req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 Gemini Chatbot Backend Server Running!`);
  console.log(`🌐 Server URL:     http://localhost:${PORT}`);
  console.log(`🖥️  Frontend UI:    http://localhost:${PORT}`);
  console.log(`🛡️  Backend API:    http://localhost:${PORT}/api/chat`);
  console.log(`⚙️  API Key Status: ${process.env.GEMINI_API_KEY ? 'Configured in .env' : 'MISSING (Use .env or UI)'}`);
  console.log(`🗄️  Supabase Status: ${supabaseService.isConfigured() ? 'Connected & Configured' : 'NOT Configured (Local/In-Memory Mode)'}`);
  console.log(`===================================================`);
});
