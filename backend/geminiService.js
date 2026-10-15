/**
 * Gemini AI Service Layer (Backend Only)
 * 
 * Securely encapsulates the Google GenAI SDK.
 * This file runs strictly on the Node.js backend.
 * Credentials and API keys NEVER touch the client browser.
 */

const { GoogleGenAI } = require('@google/genai');

/**
 * Get an initialized GoogleGenAI instance.
 * @param {string} [overrideKey] - Optional client-supplied key for testing/temporary sessions.
 * @returns {GoogleGenAI}
 */
function getClient(overrideKey) {
  const apiKey = overrideKey || process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error(
      'MISSING_API_KEY: Gemini API Key is not configured. Please set GEMINI_API_KEY in backend/.env or configure it in the web UI settings.'
    );
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Format conversation history for Gemini API.
 * Gemini expects roles: 'user' and 'model', with parts: [{ text }]
 * 
 * @param {Array<{role: string, content: string}>} history
 * @param {string} latestMessage
 * @returns {Array<object>}
 */
function formatContents(history = [], latestMessage) {
  const contents = [];

  // Add historical context
  for (const item of history) {
    if (!item.content || !item.content.trim()) continue;

    const role = item.role === 'assistant' || item.role === 'model' ? 'model' : 'user';
    contents.push({
      role: role,
      parts: [{ text: item.content }]
    });
  }

  // Add the current prompt if not already the last item
  if (latestMessage && latestMessage.trim()) {
    contents.push({
      role: 'user',
      parts: [{ text: latestMessage }]
    });
  }

  return contents;
}

/**
 * Generate a complete text response from Gemini.
 * 
 * @param {object} params
 * @param {string} params.message - Current user query
 * @param {Array} [params.history] - Array of previous messages { role, content }
 * @param {string} [params.model] - Gemini model ID (e.g., 'gemini-2.5-flash')
 * @param {string} [params.systemInstruction] - Custom system persona or instruction
 * @param {string} [params.apiKeyOverride] - Optional runtime API key
 * @returns {Promise<{text: string, model: string}>}
 */
async function generateChatResponse({
  message,
  history = [],
  model = 'gemini-2.5-flash',
  systemInstruction,
  apiKeyOverride
}) {
  const ai = getClient(apiKeyOverride);
  const contents = formatContents(history, message);

  const config = {
    temperature: 0.7,
  };

  if (systemInstruction && systemInstruction.trim()) {
    config.systemInstruction = systemInstruction.trim();
  }

  try {
    let targetModel = model || process.env.DEFAULT_MODEL || 'gemini-3.8-flash';
    try {
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: contents,
        config: config
      });

      return {
        text: response.text,
        model: targetModel,
        usage: response.usageMetadata || null
      };
    } catch (primaryErr) {
      if (primaryErr.message && primaryErr.message.includes('gemini-3.8-flash')) {
        targetModel = 'gemini-3.8-flash';
      } else if (primaryErr.message && primaryErr.message.includes('no longer available')) {
        targetModel = 'gemini-1.5-flash';
      } else {
        throw primaryErr;
      }
      console.log(`[Gemini Service]: Discontinued model detected, falling back to ${targetModel}`);
      const fallbackResponse = await ai.models.generateContent({
        model: targetModel,
        contents: contents,
        config: config
      });
      return {
        text: fallbackResponse.text,
        model: targetModel,
        usage: fallbackResponse.usageMetadata || null
      };
    }
  } catch (error) {
    handleGeminiError(error);
  }
}

/**
 * Generate a streaming text response from Gemini (SSE compatible).
 */
async function streamChatResponse({
  message,
  history = [],
  model = 'gemini-3.8-flash',
  systemInstruction,
  apiKeyOverride,
  onChunk,
  onComplete
}) {
  const ai = getClient(apiKeyOverride);
  const contents = formatContents(history, message);

  const config = {
    temperature: 0.7
  };

  if (systemInstruction && systemInstruction.trim()) {
    config.systemInstruction = systemInstruction.trim();
  }

  try {
    let targetModel = model || process.env.DEFAULT_MODEL || 'gemini-3.8-flash';
    let responseStream;
    try {
      responseStream = await ai.models.generateContentStream({
        model: targetModel,
        contents: contents,
        config: config
      });
    } catch (primaryErr) {
      if (primaryErr.message && primaryErr.message.includes('gemini-3.8-flash')) {
        targetModel = 'gemini-3.8-flash';
      } else if (primaryErr.message && primaryErr.message.includes('no longer available')) {
        targetModel = 'gemini-1.5-flash';
      } else {
        throw primaryErr;
      }
      console.log(`[Gemini Service]: Discontinued model detected, falling back to ${targetModel}`);
      responseStream = await ai.models.generateContentStream({
        model: targetModel,
        contents: contents,
        config: config
      });
    }

    for await (const chunk of responseStream) {
      if (chunk.text) {
        onChunk(chunk.text);
      }
    }

    if (onComplete) onComplete();
  } catch (error) {
    handleGeminiError(error);
  }
}

/**
 * Map Gemini SDK errors to human-friendly messages.
 */
function handleGeminiError(error) {
  const message = error.message || '';
  console.error('[Gemini Service Error]:', message);

  if (message.includes('API_KEY_INVALID') || message.includes('API key not valid')) {
    const err = new Error('Invalid Gemini API Key. Please verify your API key in backend/.env or in the Settings modal.');
    err.status = 401;
    throw err;
  }

  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
    const err = new Error('Gemini API Quota Exceeded. Please try again in a few moments or switch to a different model.');
    err.status = 429;
    throw err;
  }

  if (message.includes('model not found') || message.includes('NotFound')) {
    const err = new Error('Selected Gemini model was not found or is currently unsupported on your API tier.');
    err.status = 404;
    throw err;
  }

  const err = new Error(message || 'An error occurred while communicating with Gemini API.');
  err.status = error.status || 500;
  throw err;
}

module.exports = {
  generateChatResponse,
  streamChatResponse
};
