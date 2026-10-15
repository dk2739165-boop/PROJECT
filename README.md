# Nexus Gemini Full-Stack Chatbot with Supabase 🤖✨🗄️

A modern, production-grade conversational AI assistant powered by Google's **Gemini 2.5 LLM** and **Supabase (PostgreSQL)**, engineered with a **strict architectural differentiation between Frontend and Backend**.

---

## 🏛️ System Architecture

```
+---------------------------------------------------------------------------------+
|                                 1. CLIENT TIER                                  |
|                             (/frontend/ & frontend/.env)                        |
|                                                                                 |
|   - Vanilla HTML5 / Modern CSS3 (Glassmorphism Dark Mode) / ES6 JavaScript       |
|   - Real-time Markdown parsing (marked.js) & Syntax Highlighting (highlight.js) |
|   - Sidebar for conversation history & session management                       |
|   - Uses public SUPABASE_ANON_KEY (Row Level Security protected)                |
|   - ❌ NEVER holds GEMINI_API_KEY or SUPABASE_SERVICE_ROLE_KEY                   |
+----------------------------------------+----------------------------------------+
                                         |
                                         | HTTP REST / SSE Stream (/api/*)
                                         v
+---------------------------------------------------------------------------------+
|                                 2. SERVER TIER                                  |
|                              (/backend/ & backend/.env)                         |
|                                                                                 |
|   - Node.js Runtime + Express.js API Gateway (Port 5000)                        |
|   - Private Credential Isolation (.env)                                         |
|   - Gemini AI Service: official @google/genai SDK (gemini-2.5-flash / pro)      |
|   - Supabase Service: @supabase/supabase-js for session & message persistence   |
|   - CORS enabled, Server-Sent Events (SSE) token streaming                      |
+---------------------+-----------------------------------+-----------------------+
                      |                                   |
                      | Encrypted TLS SDK                 | SQL Queries (PostgreSQL)
                      v                                   v
+-------------------------------------+   +---------------------------------------+
|             3. AI CLOUD             |   |             4. DATABASE               |
|      (Google Gemini 2.5 API)        |   |         (Supabase PostgreSQL)         |
|   - Fast token generation & chat    |   |   - Table: chat_sessions              |
|   - Multi-turn conversation context |   |   - Table: chat_messages              |
|   - Complex reasoning & code tasks  |   |   - Row Level Security (RLS) policies |
+-------------------------------------+   +---------------------------------------+
```

---

## 🔐 Environment Variables (`.env`) Differentiation

Both the frontend and backend have dedicated `.env` files:

### 1. Frontend: [`frontend/.env`](file:///c:/Users/siri/OneDrive/Desktop/test/frontend/.env)
> **Security:** Public / Browser-safe. These variables are exposed to the browser client and protected by Supabase Row Level Security (RLS).

| Variable | Description | Example |
| :--- | :--- | :--- |
| `BACKEND_URL` | Base URL of the Node.js/Express server | `http://localhost:5000` |
| `SUPABASE_URL` | Public project URL from Supabase dashboard | `https://your-project.supabase.co` |
| `SUPABASE_ANON_KEY` | Public anonymous API key (safe for browser) | `eyJhbGciOi...` |

### 2. Backend: [`backend/.env`](file:///c:/Users/siri/OneDrive/Desktop/test/backend/.env)
> **Security:** Confidential / Server-Only. These variables are quarantined on the server and are NEVER sent to or visible in the browser.

| Variable | Description | Example |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Secret Google Gemini API Key | `AIzaSy...` |
| `PORT` | Local server port | `5000` |
| `DEFAULT_MODEL` | Default Gemini model ID | `gemini-2.5-flash` |
| `SUPABASE_URL` | Supabase project URL | `https://your-project.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase public anon key | `eyJhbGciOi...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret admin key for database operations | `eyJhbGciOi...` |

---

## 🗄️ Supabase Database Setup

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Create a new project (or use an existing one).
3. Navigate to **SQL Editor** -> **New Query**.
4. Open the included schema file: [**`supabase_schema.sql`**](file:///c:/Users/siri/OneDrive/Desktop/test/supabase_schema.sql).
5. Paste the SQL and click **Run**.

This creates:
- **`chat_sessions`**: Tracks conversation threads, titles, timestamps, and model settings.
- **`chat_messages`**: Stores user queries and AI responses with foreign key cascades and indexes.
- **Row Level Security (RLS)**: Pre-configured permissive policies for development and demo mode.

---

## 🚀 Quick Start Guide

### Step 1: Configure Keys in `.env` Files

1. Open [**`backend/.env`**](file:///c:/Users/siri/OneDrive/Desktop/test/backend/.env):
   ```env
   GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere
   PORT=5000
   DEFAULT_MODEL=gemini-2.5-flash
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-supabase-anon-key-here
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-here
   ```

2. Open [**`frontend/.env`**](file:///c:/Users/siri/OneDrive/Desktop/test/frontend/.env):
   ```env
   BACKEND_URL=http://localhost:5000
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-supabase-anon-key-here
   ```

> 💡 **Tip:** You can also configure both your Gemini API key and Supabase credentials dynamically in the web UI by clicking the **⚙️ Settings** icon in the header.

### Step 2: Run the Server

From the root directory:
```bash
npm start
```

Or from the backend folder:
```bash
cd backend
npm start
```

### Step 3: Open in Browser

Open your browser to:
👉 **[http://localhost:5000](http://localhost:5000)**

---

## 🌟 Features

- **Decoupled Architecture**: Absolute separation between UI components and server credentials.
- **Server-Sent Events (SSE) Streaming**: Instant token-by-token output from Gemini 2.5 Flash & Pro.
- **Persistent Chat History**: Past conversations automatically persist to Supabase PostgreSQL and appear in the left sidebar.
- **New Chat & Session Switching**: Click any previous conversation in the sidebar to review its message logs, or start a new conversation.
- **Interactive Architecture Inspector**: Click the **Architecture & .env** button in the header to review the live data flow and security matrix.
- **Markdown & Code Highlighting**: Automatic formatting with language badges and one-click copy buttons.
