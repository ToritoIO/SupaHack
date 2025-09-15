# SupaHack - Supabase REST Explorer

A Streamlit web app for exploring and testing exposed Supabase databases through the PostgREST API.

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

## Configuration

- **Project ID**: Found in your Supabase project URL (`https://PROJECT_ID.supabase.co`)
- **API Key**: Use `anon` key for public access or `service_role` for full access
- **Schema**: Default is `public`, change if using custom schemas

## Security Note

Never expose your `service_role` key in client-side applications. Use `anon` key with Row Level Security (RLS) for browser usage.
