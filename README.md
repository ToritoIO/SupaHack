# SupaHack - Supabase REST Explorer

A Streamlit web app for exploring and testing exposed Supabase databases through the PostgREST API.

## Online Demo

https://supahack.streamlit.app

## Features

- **Connect** to any Supabase project using Project ID and API key
- **Browse** all tables and views with row counts
- **Query** data with filtering, sorting, and pagination
- **Write** operations: INSERT, UPDATE, DELETE rows
- **Auto-discover** table columns from OpenAPI schema or actual data
- **Export** results to CSV

## Quick Start

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the app:
```bash
streamlit run supahack.py
```

3. Open your browser to `http://localhost:8501`

## Usage

1. **Connect**: Enter your Supabase Project ID and API key in the sidebar
2. **Explore**: Select a table to view its data and structure
3. **Query**: Use filters, sorting, and pagination to find specific data
4. **Write**: Switch to the "Write Data" tab for INSERT/UPDATE/DELETE operations

## Chrome Side Panel Extension

The repository now also ships with a Chrome extension (Manifest V3) located in `chrome_extension/`. It mirrors the Streamlit experience inside the browser side panel.

### Load the extension

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose the `chrome_extension` folder.
4. Click the SupaHack puzzle-piece icon in your toolbar to open the side panel.

### Extension workflow

- Fill in your Supabase **Project ID**, **schema**, and **apiKey** (optionally a separate Bearer token).
- Click **Connect / Refresh** to retrieve the OpenAPI spec and table list; credentials are stored in `chrome.storage.local`.
- Select a table and press **Explore data** to open the 90% width/height modal explorer.
- Use the theme chooser in the header to flip between dark and light UI styles.
- Use the **Browse** tab for filtering, ordering, and pagination. The **Insert**, **Update**, and **Delete** tabs expose the corresponding PostgREST operations.

When you press **Explore data**, the extension injects a modal overlay on top of the current page instead of rendering inside the side panel, giving a full-width workspace while keeping the browser tab context.

> ⚠️ Just like the Streamlit app, avoid shipping `service_role` keys to untrusted environments.

## Configuration

- **Project ID**: Found in your Supabase project URL (`https://PROJECT_ID.supabase.co`)
- **API Key**: Use `anon` key for public access or `service_role` for full access
- **Schema**: Default is `public`, change if using custom schemas

## Security Note

Never expose your `service_role` key in client-side applications. Use `anon` key with Row Level Security (RLS) for browser usage.
