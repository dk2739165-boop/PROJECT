/**
 * Supabase Database Service (Backend Layer)
 * 
 * Manages chat session persistence and message logs in Supabase PostgreSQL.
 * Securely utilizes SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY on the server.
 */

const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;

/**
 * Get or initialize the Supabase client
 * @param {object} [runtimeConfig] - Optional runtime URL/Key overrides
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
function getSupabaseClient(runtimeConfig = {}) {
  const url = runtimeConfig.url || process.env.SUPABASE_URL;
  const key = runtimeConfig.key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('your-project-id') || key.includes('your-supabase')) {
    return null;
  }

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(url, key, {
        auth: { persistSession: false }
      });
      console.log('[Supabase Service]: Initialized connected client.');
    } catch (err) {
      console.error('[Supabase Service Init Error]:', err.message);
      return null;
    }
  }

  return supabaseClient;
}

/**
 * Check if Supabase credentials are configured
 */
function isConfigured() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return Boolean(
    url && 
    key && 
    url.trim() !== '' && 
    key.trim() !== '' && 
    !url.includes('your-project-id') && 
    !key.includes('your-supabase')
  );
}

/**
 * Create a new conversation session
 */
async function createSession({ title = 'New Conversation', model = 'gemini-2.5-flash' } = {}) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('chat_sessions')
    .insert([{ title, model }])
    .select()
    .single();

  if (error) {
    console.error('[Supabase createSession Error]:', error.message);
    throw error;
  }

  return data;
}

/**
 * Fetch all chat sessions ordered by latest updated
 */
async function getSessions(limit = 40) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('chat_sessions')
    .select('id, title, model, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Supabase getSessions Error]:', error.message);
    throw error;
  }

  return data || [];
}

/**
 * Get a specific chat session by ID
 */
async function getSession(sessionId) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) {
    console.error('[Supabase getSession Error]:', error.message);
    return null;
  }

  return data;
}

/**
 * Fetch messages for a specific session
 */
async function getMessages(sessionId) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('chat_messages')
    .select('id, role, content, model, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Supabase getMessages Error]:', error.message);
    throw error;
  }

  return data || [];
}

/**
 * Save a message and touch session updated_at
 */
async function saveMessage({ sessionId, role, content, model }) {
  const client = getSupabaseClient();
  if (!client) return null;

  // Insert message
  const { data, error } = await client
    .from('chat_messages')
    .insert([{
      session_id: sessionId,
      role,
      content,
      model
    }])
    .select()
    .single();

  if (error) {
    console.error('[Supabase saveMessage Error]:', error.message);
    throw error;
  }

  // Update session updated_at
  await client
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  return data;
}

/**
 * Delete a session and all its messages (cascade)
 */
async function deleteSession(sessionId) {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    console.error('[Supabase deleteSession Error]:', error.message);
    throw error;
  }

  return true;
}

/**
 * Update session title
 */
async function updateSessionTitle(sessionId, title) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('chat_sessions')
    .update({ title })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) {
    console.error('[Supabase updateSessionTitle Error]:', error.message);
    return null;
  }

  return data;
}

module.exports = {
  getSupabaseClient,
  isConfigured,
  createSession,
  getSessions,
  getSession,
  getMessages,
  saveMessage,
  deleteSession,
  updateSessionTitle
};
