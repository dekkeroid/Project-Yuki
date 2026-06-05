import uvicorn
import os
import sys

if sys.stdout:
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr:
    sys.stderr.reconfigure(encoding='utf-8')

if __name__ == "__main__":
    print("Launching Yuki Desktop Assistant Backend...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
