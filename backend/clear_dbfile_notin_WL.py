import sys
import os

# Get the absolute path of the 'backend' folder
backend_dir = os.path.dirname(os.path.abspath(__file__))

# Add 'backend' to sys.path so Python can see the 'app' directory correctly
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

try:
    from app.memory import db
    from app.memory.crawler import EXT_CATEGORIES
    print("[Clean] Successfully imported project modules.")
except ImportError as e:
    print(f"[Error] Failed to import project database or crawler modules: {e}")
    print(f"Debug Info: Script location is '{backend_dir}'")
    sys.exit(1)

def prune_unwanted_extensions():
    # 1. Get the list of whitelisted extensions from your crawler configuration
    whitelist = list(EXT_CATEGORIES.keys())
    
    if not whitelist:
        print("[Error] Whitelist is empty! Aborting to protect database data.")
        return

    print(f"[Clean] Loaded {len(whitelist)} whitelisted extensions.")
    
    # 2. Establish database connection
    conn = db.get_connection()
    cursor = conn.cursor()
    
    try:
        # Create SQL placeholders (?, ?, ?) for the IN clause
        placeholders = ",".join("?" for _ in whitelist)
        
        # 3. First, count how many records will be removed (for safety logging)
        count_query = f"SELECT COUNT(*) FROM files WHERE LOWER(extension) NOT IN ({placeholders})"
        cursor.execute(count_query, whitelist)
        records_to_delete = cursor.fetchone()[0]
        
        if records_to_delete == 0:
            print("[Clean] Your database is already perfectly clean! No non-whitelisted files found.")
            return
            
        print(f"[Clean] Found {records_to_delete} records with non-whitelisted extensions marked for deletion.")
        
        # 4. Perform the deletion
        delete_query = f"DELETE FROM files WHERE LOWER(extension) NOT IN ({placeholders})"
        cursor.execute(delete_query, whitelist)
        
        # 5. Commit changes to save the structural cleanup permanently
        conn.commit()
        print(f"[SUCCESS] Successfully deleted {records_to_delete} legacy records from the database.")
        
        # 6. Optimize the database file size
        print("[Clean] Compacting database file allocation table (VACUUM)...")
        cursor.execute("VACUUM")
        print("[Clean] Database optimization complete.")
        
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Database transaction failed, changes rolled back safely: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    print("=== Yuki DB Extension Pruner ===")
    # Quick confirmation check
    confirm = input("This will permanently delete all files from the DB that don't match your whitelist. Proceed? (y/n): ")
    if confirm.lower() == 'y':
        prune_unwanted_extensions()
    else:
        print("[Aborted] No changes made to the database.")