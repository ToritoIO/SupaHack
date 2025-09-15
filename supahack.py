import streamlit as st
import requests
import pandas as pd

st.set_page_config(page_title="SupaHack - Supabase REST Explorer", layout="wide")
st.title("🔎 SupaHack - Supabase REST Explorer (PostgREST)")

with st.sidebar:
    st.header("Connection")
    project_id = st.text_input(
        "Supabase Project ID",
        value="",
        placeholder="xgukkzjwudbxyiohspsv",
        help="Found in your Supabase project URL",
    )
    
    # Build the base URL from project ID
    if project_id.strip():
        base_url = f"https://{project_id.strip()}.supabase.co/rest/v1"
        st.caption(f"📍 **URL:** {base_url}")
    else:
        base_url = ""
    
    schema = st.text_input("Schema (Accept-Profile)", value="public")
    api_key = st.text_input("apiKey", type="password", help="Your anon or service key", placeholder="Your API key")
    bearer = st.text_input(
        "Bearer token",
        type="password",
        help="Often the same as apiKey for anon access",
        value=api_key.strip() if api_key else "",
    )
    connect = st.button("Connect / Refresh", type="primary")
    st.markdown("---")
    st.caption(
        "Tip: Use anon key for public reads (with RLS). For privileged access, run on a server—never ship service_role to browsers."
    )

def _headers(api_key: str, bearer: str, schema: str, accept="application/json"):
    # Strip whitespace from all values to avoid header validation errors
    clean_api_key = (api_key or "").strip()
    clean_bearer = (bearer or api_key or "").strip()
    clean_schema = (schema or "public").strip()
    
    return {
        "apikey": clean_api_key,
        "authorization": f"Bearer {clean_bearer}",
        "Accept-Profile": clean_schema,
        "accept": accept,
        "cache-control": "no-cache",
    }

@st.cache_data(show_spinner=False)
def fetch_openapi(base_url: str, api_key: str, bearer: str, schema: str):
    url = base_url.rstrip("/") + "/"
    headers = _headers(api_key, bearer, schema, accept="application/openapi+json;version=3.0")
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()

def parse_tables_from_openapi(oa: dict):
    paths = oa.get("paths", {}) or {}
    names = set()
    for path in paths.keys():
        if not path.startswith("/"):
            continue
        if path.startswith("/rpc/"):
            continue
        seg = path.split("?")[0].strip("/")
        if not seg or "/" in seg:
            continue
        names.add(seg)
    return sorted(names)

def extract_columns_from_openapi(oa: dict, table: str, schema: str):
    comps = (oa.get("components", {}) or {}).get("schemas", {}) or {}
    candidates = [
        f"{schema}_{table}",
        f"{table}",
        f"{schema}.{table}",
        f"{table}_insert",
        f"{table}_update",
    ]
    found_columns = set()
    
    # Collect columns from all matching schemas
    for cand in candidates:
        if cand in comps and isinstance(comps[cand], dict):
            props = comps[cand].get("properties", {}) or {}
            if props:
                found_columns.update(props.keys())
    
    return sorted(list(found_columns)) if found_columns else None

def get_all_schema_names(oa: dict, table: str, schema: str):
    """Get all schema names related to the table for debugging"""
    comps = (oa.get("components", {}) or {}).get("schemas", {}) or {}
    table_schemas = {}
    
    for schema_name, schema_def in comps.items():
        if table.lower() in schema_name.lower():
            if isinstance(schema_def, dict) and "properties" in schema_def:
                table_schemas[schema_name] = list(schema_def["properties"].keys())
    
    return table_schemas

def infer_columns_from_data(base_url, table, api_key, bearer, schema, sample_size=10):
    """Fetch a small sample of data to infer all available columns"""
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    params = {"limit": str(sample_size), "select": "*"}
    
    try:
        r = requests.get(url, headers=headers, params=params, timeout=30)
        if r.ok:
            rows = r.json()
            if isinstance(rows, list) and rows:
                return sorted(set().union(*[row.keys() for row in rows if isinstance(row, dict)]))
    except Exception:
        pass
    return None

def get_total_count(base_url, table, api_key, bearer, schema, params):
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    headers["Prefer"] = "count=exact"
    p = dict(params or {})
    p["limit"] = 1
    r = requests.get(url, headers=headers, params=p, timeout=30)
    if not r.ok:
        return None, r
    cr = r.headers.get("Content-Range")
    total = None
    if cr and "/" in cr:
        try:
            total_part = cr.split("/")[-1]
            if total_part != "*":
                total = int(total_part)
        except Exception:
            total = None
    return total, r

def fetch_rows(base_url, table, api_key, bearer, schema, params):
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    return requests.get(url, headers=headers, params=params, timeout=60)

def insert_row(base_url, table, api_key, bearer, schema, data):
    """Insert a new row into the table"""
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    return requests.post(url, headers=headers, json=data, timeout=30)

def update_rows(base_url, table, api_key, bearer, schema, data, filter_params):
    """Update rows in the table based on filter"""
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    return requests.patch(url, headers=headers, json=data, params=filter_params, timeout=30)

def delete_rows(base_url, table, api_key, bearer, schema, filter_params):
    """Delete rows from the table based on filter"""
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    headers["Prefer"] = "return=representation"
    return requests.delete(url, headers=headers, params=filter_params, timeout=30)

def get_table_row_count(base_url, table, api_key, bearer, schema):
    """Get row count for a specific table"""
    url = f"{base_url.rstrip('/')}/{table}"
    headers = _headers(api_key, bearer, schema)
    headers["Prefer"] = "count=exact"
    params = {"limit": 1}
    
    try:
        r = requests.get(url, headers=headers, params=params, timeout=10)
        if r.ok:
            cr = r.headers.get("Content-Range")
            if cr and "/" in cr:
                try:
                    total_part = cr.split("/")[-1]
                    if total_part != "*":
                        return int(total_part)
                except Exception:
                    pass
        return None
    except Exception:
        return None

@st.cache_data(show_spinner=False, ttl=300)  # Cache for 5 minutes
def get_all_table_counts(base_url, api_key, bearer, schema, tables):
    """Get row counts for all tables"""
    counts = {}
    progress_placeholder = st.empty()
    
    for i, table in enumerate(tables):
        progress_placeholder.text(f"Getting row counts... {i+1}/{len(tables)} ({table})")
        count = get_table_row_count(base_url, table, api_key, bearer, schema)
        counts[table] = count
    
    progress_placeholder.empty()
    return counts

# Connect & cache OpenAPI - only when Connect button is clicked
if connect:
    if base_url and (api_key or bearer):
        try:
            with st.spinner("Fetching OpenAPI…"):
                st.session_state.openapi = fetch_openapi(base_url, api_key, bearer, schema)
                st.session_state.tables = parse_tables_from_openapi(st.session_state.openapi)
                # Clear cached counts when connecting to a new database
                get_all_table_counts.clear()
        except Exception as e:
            st.error(f"Failed to fetch OpenAPI: {e}")
    else:
        st.warning("Please fill base URL and an apiKey (Bearer optional).")

oa = st.session_state.get("openapi")
tables = st.session_state.get("tables", [])

if not oa:
    st.info("Enter your connection info in the sidebar and click **Connect / Refresh**.")
    st.stop()

st.subheader("Tables / Views")

# Get table counts only when tables are available and connection is established
table_counts = {}
if tables and base_url and (api_key or bearer):
    # Check if we should load counts automatically or wait for user action
    load_counts = st.checkbox("Load row counts automatically", value=False, help="Automatically load row counts for all tables (may be slow for many tables)")
    
    if load_counts:
        with st.spinner("Loading table row counts..."):
            table_counts = get_all_table_counts(base_url, api_key, bearer, schema, tables)
    else:
        st.info("💡 Enable 'Load row counts automatically' above or use 'Load counts' button to see table sizes.")

# Create table options with counts and sort by count (highest first)
table_data = []
table_display_map = {}  # Map display name back to actual table name

for table in tables:
    count = table_counts.get(table)
    if count is not None:
        display_name = f"{table} ({count:,})"
        sort_key = count  # Use actual count for sorting
    elif count == 0:
        display_name = f"{table} (0)"
        sort_key = 0
    else:
        display_name = f"{table} (?)"
        sort_key = -1  # Put unknown counts at the end
    
    table_data.append((display_name, table, sort_key))

# Sort by count (highest first), then by table name alphabetically
table_data.sort(key=lambda x: (-x[2], x[1]))

table_options = [item[0] for item in table_data]
for display_name, table_name, _ in table_data:
    table_display_map[display_name] = table_name

col_left, col_right = st.columns([2, 1])
with col_left:
    selected_display = st.selectbox("Select a table/view", options=table_options, index=0 if table_options else None)
    selected_table = table_display_map.get(selected_display) if selected_display else None

with col_right:
    refresh_tables = st.button("Reload table list")
    
    # Show different buttons based on whether counts are loaded
    if table_counts:
        refresh_counts = st.button("Refresh counts")
    else:
        load_counts_btn = st.button("Load counts", help="Load row counts for all tables")
    
    # Create copy button for table list
    if table_options:
        copy_text = "\n".join(table_options)
        if st.button("📋 Copy list", help="Copy table names with counts"):
            st.code(copy_text, language="text")
            st.success("Table list displayed above - you can select and copy it!")

if refresh_tables:
    try:
        st.session_state.openapi = fetch_openapi(base_url, api_key, bearer, schema)
        st.session_state.tables = parse_tables_from_openapi(st.session_state.openapi)
        tables = st.session_state.tables
        # Clear the cached counts so they get refreshed
        get_all_table_counts.clear()
        st.success("Table list refreshed.")
        st.rerun()
    except Exception as e:
        st.error(f"Failed to refresh: {e}")

# Handle refresh counts button (only shown when counts are already loaded)
if 'refresh_counts' in locals() and refresh_counts:
    # Clear cached counts and rerun to refresh
    get_all_table_counts.clear()
    st.success("Counts refreshed.")
    st.rerun()

# Handle load counts button (only shown when counts are not loaded)
if 'load_counts_btn' in locals() and load_counts_btn:
    with st.spinner("Loading table row counts..."):
        table_counts = get_all_table_counts(base_url, api_key, bearer, schema, tables)
    st.success("Row counts loaded!")
    st.rerun()

if not selected_table:
    st.stop()

# Add operation tabs
tab1, tab2 = st.tabs(["🔍 Read Data", "✏️ Write Data"])

with tab1:
    columns_from_oa = extract_columns_from_openapi(oa, selected_table, schema)
inferred_columns = None

# Initialize table-specific session state
if "table_columns_cache" not in st.session_state:
    st.session_state.table_columns_cache = {}

table_key = f"{selected_table}_{schema}"

# Add column discovery options
col_discovery = st.expander("🔍 Column Discovery & Debug", expanded=False)
with col_discovery:
    dc1, dc2 = st.columns([1, 1])
    with dc1:
        force_infer = st.button("Infer columns from actual data", help="Fetch sample data to discover all available columns")
        show_schemas = st.button("Show OpenAPI schemas", help="Debug: show all schema definitions for this table")
        auto_infer = st.checkbox("Auto-infer on table change", value=True, help="Automatically discover columns when switching tables")
    
    with dc2:
        combine_sources = st.checkbox("Combine OpenAPI + inferred columns", value=True, help="Use both OpenAPI and actual data to find columns")
        clear_cache = st.button("Clear column cache", help="Clear cached column data for all tables")
    
    if clear_cache:
        st.session_state.table_columns_cache = {}
        st.success("Column cache cleared!")
    
    # Auto-infer or manual infer
    should_infer = force_infer or (auto_infer and combine_sources and table_key not in st.session_state.table_columns_cache)
    
    if should_infer or (combine_sources and table_key in st.session_state.table_columns_cache):
        if should_infer:
            with st.spinner("Inferring columns from data..."):
                inferred_cols = infer_columns_from_data(base_url, selected_table, api_key, bearer, schema)
                st.session_state.table_columns_cache[table_key] = inferred_cols
        
        inferred_columns = st.session_state.table_columns_cache.get(table_key)
        
        if inferred_columns:
            st.success(f"Found {len(inferred_columns)} columns from actual data")
            st.code(", ".join(inferred_columns))
        else:
            st.warning("Could not infer columns from data (table might be empty or access restricted)")
    
    if show_schemas:
        table_schemas = get_all_schema_names(oa, selected_table, schema)
        if table_schemas:
            st.subheader("OpenAPI Schemas found:")
            for schema_name, cols in table_schemas.items():
                st.write(f"**{schema_name}**: {', '.join(cols)}")
        else:
            st.info("No OpenAPI schemas found for this table")
    
    # Show cache status
    cached_tables = list(st.session_state.table_columns_cache.keys())
    if cached_tables:
        st.caption(f"Cached column data for: {', '.join(cached_tables)}")

# Determine final column list
final_columns = None
if combine_sources and inferred_columns and columns_from_oa:
    # Combine both sources, prioritizing inferred (more complete)
    final_columns = sorted(set(inferred_columns + columns_from_oa))
    st.info(f"Using combined columns: {len(columns_from_oa)} from OpenAPI + {len(inferred_columns)} from data = {len(final_columns)} total")
elif inferred_columns:
    final_columns = inferred_columns
    st.info("Using columns inferred from actual data")
elif columns_from_oa:
    final_columns = columns_from_oa
    st.info("Using columns from OpenAPI schema")

with st.expander("Query options", expanded=True):
    qc1, qc2, qc3, qc4 = st.columns([2, 1, 1, 1])
    with qc1:
        if final_columns:
            selected_columns = st.multiselect(
                "Columns (discovered)", options=final_columns, default=final_columns
            )
        else:
            selected_columns = st.text_input("Columns (comma-separated, leave empty for '*')", value="")
    with qc2:
        page_size = st.number_input("Page size", min_value=1, max_value=1000, value=100, step=10)
    with qc3:
        page = st.number_input("Page (1-based)", min_value=1, value=1, step=1)
    with qc4:
        refresh_rows = st.button("Run query", type="primary")

    oc1, oc2, oc3, oc4, oc5 = st.columns([1.6, 1, 1, 1, 1.2])
    with oc1:
        order_col = st.selectbox("Order by", options=final_columns or [], index=0 if final_columns else None, placeholder="Select column")
    with oc2:
        order_dir = st.selectbox("Direction", options=["asc", "desc"], index=0)
    with oc3:
        filter_col = st.selectbox("Filter column", options=(final_columns or []), index=0 if final_columns else None, placeholder="Select")
    with oc4:
        op = st.selectbox(
            "Op",
            options=["eq","neq","gt","gte","lt","lte","ilike","like","is","in","cs","cd"],
            index=0,
            help="PostgREST operators",
        )
    with oc5:
        filter_val = st.text_input("Value (for 'in', use (a,b,c))", value="")

params = {}
if isinstance(selected_columns, list) and selected_columns:
    params["select"] = ",".join(selected_columns)
elif isinstance(selected_columns, str) and selected_columns.strip():
    params["select"] = selected_columns.strip()
else:
    params["select"] = "*"

limit = int(page_size)
offset = (int(page) - 1) * limit
params["limit"] = str(limit)
params["offset"] = str(offset)

if order_col:
    params["order"] = f"{order_col}.{order_dir}"

if filter_col and op and (op == "is" or filter_val.strip() != ""):
    val = filter_val.strip()
    if op == "in":
        if not (val.startswith("(") and val.endswith(")")):
            val = f"({val})"
    params[f"{filter_col}"] = f"{op}.{val}"

# Only proceed if we have a valid base_url
if not base_url:
    st.error("Please enter a valid Supabase Project ID to proceed.")
    st.stop()

total_count, count_resp = get_total_count(base_url, selected_table, api_key, bearer, schema, params)
if count_resp is not None and not count_resp.ok:
    st.error(f"Count request failed: {count_resp.status_code} {count_resp.text}")
else:
    if total_count is not None:
        st.caption(f"Total rows (with current filters): **{total_count:,}**")
        
        # Warn about very large datasets
        if total_count > 10000:
            st.warning(f"⚠️ Large dataset ({total_count:,} rows). Consider using filters or smaller page sizes to improve performance.")
        elif total_count > 1000 and int(page_size) > 100:
            st.info(f"💡 Tip: With {total_count:,} total rows, consider reducing page size for faster loading.")
    else:
        st.caption("Total rows: unknown")

data_resp = fetch_rows(base_url, selected_table, api_key, bearer, schema, params)
if not data_resp.ok:
    st.error(f"Data request failed: {data_resp.status_code} {data_resp.text}")
    
    # Show specific guidance for common PostgREST errors
    if data_resp.status_code == 406:
        st.info("💡 **Tip**: This error often occurs when requesting too many rows. Try reducing the page size or adding filters.")
    elif "PGRST116" in data_resp.text:
        st.info("💡 **PostgREST Error**: The response contains too many rows for a single object. This usually happens when PostgREST expects one result but gets many.")
    
    st.stop()

try:
    rows = data_resp.json()
except Exception as e:
    st.error(f"Failed to parse JSON from response: {e}")
    st.error(f"Response content: {data_resp.text[:500]}...")
    st.stop()

# Check if rows is the expected format
if not isinstance(rows, list):
    st.error(f"Unexpected response format. Expected list, got {type(rows)}:")
    st.json(rows)
    st.stop()

# Handle empty results
if not rows:
    st.info("No rows returned from query.")
    st.stop()

# Show column information if we're relying on inference
if not final_columns and isinstance(rows, list) and rows:
    current_inferred = sorted(set().union(*[r.keys() for r in rows if isinstance(r, dict)]))
    st.info("Columns inferred from current query results (no column definitions available).")
    with st.expander("Inferred columns from current results", expanded=False):
        st.code(", ".join(current_inferred))

st.subheader(f"Rows from `{selected_table}`")

# Additional safety check before creating DataFrame
try:
    df = pd.DataFrame(rows)
    if df.empty:
        st.info("DataFrame is empty - no data to display.")
    else:
        st.dataframe(df, use_container_width=True, height=500)
        
        csv = df.to_csv(index=False).encode("utf-8")
        st.download_button("Download CSV", data=csv, file_name=f"{selected_table}.csv", mime="text/csv")
except Exception as e:
    st.error(f"Failed to create DataFrame: {e}")
    st.error("Raw data:")
    st.json(rows[:5] if len(rows) > 5 else rows)  # Show first 5 rows for debugging

with st.expander("Raw response JSON"):
    st.json(rows)

with st.expander("Request details (debug)"):
    st.write("Endpoint:", f"{base_url.rstrip('/')}/{selected_table}")
    st.write("Params:", params)
    redacted = {k: ("***" if k.lower() in ("authorization", "apikey") else v) for k, v in _headers(api_key, bearer, schema).items()}
    st.write("Headers:", redacted)
    st.write("Status:", data_resp.status_code)
    st.write("Content-Range:", data_resp.headers.get("Content-Range"))
    st.write("Response headers:", dict(data_resp.headers))

with tab2:
    # Get columns for the write operations
    write_columns = final_columns if final_columns else infer_columns_from_data(base_url, selected_table, api_key, bearer, schema, 5)
    
    if not write_columns:
        st.warning("No columns found. Please switch to Read tab first to discover table structure.")
        st.stop()
    
    operation = st.selectbox("Operation", ["INSERT", "UPDATE", "DELETE"])
    
    if operation == "INSERT":
        st.subheader("Insert New Row")
        
        # Create input fields for each column
        insert_data = {}
        cols = st.columns(3)
        for i, col in enumerate(write_columns):
            with cols[i % 3]:
                value = st.text_input(f"{col}", key=f"insert_{col}")
                if value.strip():
                    # Try to convert to appropriate type
                    if value.lower() in ["true", "false"]:
                        insert_data[col] = value.lower() == "true"
                    elif value.isdigit():
                        insert_data[col] = int(value)
                    elif value.replace(".", "").isdigit():
                        insert_data[col] = float(value)
                    else:
                        insert_data[col] = value
        
        if st.button("Insert Row", type="primary"):
            if insert_data:
                try:
                    with st.spinner("Inserting row..."):
                        resp = insert_row(base_url, selected_table, api_key, bearer, schema, insert_data)
                    
                    if resp.ok:
                        st.success("Row inserted successfully!")
                        result = resp.json()
                        st.json(result)
                    else:
                        st.error(f"Insert failed: {resp.status_code} - {resp.text}")
                except Exception as e:
                    st.error(f"Error: {e}")
            else:
                st.warning("Please fill at least one field.")
    
    elif operation == "UPDATE":
        st.subheader("Update Rows")
        
        # Filter section
        st.write("**Filter (which rows to update):**")
        fc1, fc2, fc3 = st.columns([1, 1, 1])
        with fc1:
            filter_col = st.selectbox("Filter column", options=write_columns, key="update_filter_col")
        with fc2:
            filter_op = st.selectbox("Operator", options=["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike"], key="update_filter_op")
        with fc3:
            filter_val = st.text_input("Filter value", key="update_filter_val")
        
        # Update data section
        st.write("**New values:**")
        update_data = {}
        cols = st.columns(3)
        for i, col in enumerate(write_columns):
            with cols[i % 3]:
                value = st.text_input(f"New {col}", key=f"update_{col}")
                if value.strip():
                    # Try to convert to appropriate type
                    if value.lower() in ["true", "false"]:
                        update_data[col] = value.lower() == "true"
                    elif value.isdigit():
                        update_data[col] = int(value)
                    elif value.replace(".", "").isdigit():
                        update_data[col] = float(value)
                    else:
                        update_data[col] = value
        
        if st.button("Update Rows", type="primary"):
            if filter_col and filter_val and update_data:
                filter_params = {f"{filter_col}": f"{filter_op}.{filter_val}"}
                try:
                    with st.spinner("Updating rows..."):
                        resp = update_rows(base_url, selected_table, api_key, bearer, schema, update_data, filter_params)
                    
                    if resp.ok:
                        st.success("Rows updated successfully!")
                        result = resp.json()
                        st.json(result)
                    else:
                        st.error(f"Update failed: {resp.status_code} - {resp.text}")
                except Exception as e:
                    st.error(f"Error: {e}")
            else:
                st.warning("Please provide filter criteria and at least one field to update.")
    
    elif operation == "DELETE":
        st.subheader("Delete Rows")
        st.warning("⚠️ This operation cannot be undone!")
        
        # Filter section
        st.write("**Filter (which rows to delete):**")
        fc1, fc2, fc3 = st.columns([1, 1, 1])
        with fc1:
            filter_col = st.selectbox("Filter column", options=write_columns, key="delete_filter_col")
        with fc2:
            filter_op = st.selectbox("Operator", options=["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike"], key="delete_filter_op")
        with fc3:
            filter_val = st.text_input("Filter value", key="delete_filter_val")
        
        # Safety checkbox
        confirm_delete = st.checkbox("I understand this will permanently delete data")
        
        if st.button("Delete Rows", type="primary", disabled=not confirm_delete):
            if filter_col and filter_val:
                filter_params = {f"{filter_col}": f"{filter_op}.{filter_val}"}
                try:
                    with st.spinner("Deleting rows..."):
                        resp = delete_rows(base_url, selected_table, api_key, bearer, schema, filter_params)
                    
                    if resp.ok:
                        st.success("Rows deleted successfully!")
                        result = resp.json()
                        st.json(result)
                    else:
                        st.error(f"Delete failed: {resp.status_code} - {resp.text}")
                except Exception as e:
                    st.error(f"Error: {e}")
            else:
                st.warning("Please provide filter criteria.")

st.markdown("---")
st.caption("Built with ❤️ using Streamlit + PostgREST. Keep keys safe; prefer server-side usage for privileged access.")
