import os
import json
import asyncio
import sys
from typing import Dict, List, Any, Optional

class LSPClient:
    """
    Lightweight, zero-dependency stdio JSON-RPC 2.0 LSP Client for Python (pyright)
    and TypeScript/JavaScript (typescript-language-server).
    """

    def __init__(self, workspace_dir: str):
        self.workspace_dir = os.path.abspath(workspace_dir)
        self.process: Optional[asyncio.subprocess.Process] = None
        self.msg_id = 0
        self.diagnostics_cache: Dict[str, List[Dict[str, Any]]] = {}
        self.server_type: Optional[str] = None
        self._reader_task: Optional[asyncio.Task] = None

    async def start_server(self, file_path: str) -> bool:
        if self.process and self.process.returncode is None:
            return True

        ext = os.path.splitext(file_path)[1].lower()
        cmd = []

        if ext in ('.py', '.pyi'):
            cmd = ['pyright-langserver', '--stdio']
            self.server_type = 'python'
        elif ext in ('.js', '.jsx', '.ts', '.tsx', '.json'):
            cmd = ['typescript-language-server', '--stdio']
            self.server_type = 'typescript'
        elif ext == '.rs':
            cmd = ['rust-analyzer']
            self.server_type = 'rust'
        elif ext in ('.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'):
            cmd = ['clangd']
            self.server_type = 'cpp'
        elif ext == '.go':
            cmd = ['gopls']
            self.server_type = 'go'
        elif ext in ('.html', '.htm'):
            cmd = ['vscode-html-language-server', '--stdio']
            self.server_type = 'html'
        elif ext in ('.css', '.scss'):
            cmd = ['vscode-css-language-server', '--stdio']
            self.server_type = 'css'
        else:
            return False

        try:
            # Check if command exists in PATH (or npx fallback)
            executable = cmd[0]
            if sys.platform == 'win32':
                executable_check = f"where {executable}"
            else:
                executable_check = f"which {executable}"

            proc_check = await asyncio.create_subprocess_shell(
                executable_check,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc_check.communicate()
            if proc_check.returncode != 0 or not stdout.strip():
                # Try npx fallbacks for typescript and python
                if self.server_type == 'typescript':
                    cmd = ['npx', '-y', 'typescript-language-server', '--stdio']
                elif self.server_type == 'python':
                    cmd = ['npx', '-y', 'pyright', '--stdio']
                else:
                    print(f"[LSP] {executable} not found in PATH. LSP diagnostics disabled for {ext}.")
                    return False

            print(f"[LSP] Starting {self.server_type} server: {' '.join(cmd)} in {self.workspace_dir}")
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.workspace_dir
            )

            self._reader_task = asyncio.create_task(self._read_responses())
            await self._initialize()
            return True
        except Exception as e:
            print(f"[LSP] Failed to start LSP server for {file_path}: {e}")
            return False

    async def _send_rpc(self, method: str, params: Optional[Dict[str, Any]] = None, is_notification: bool = False) -> int:
        if not self.process or not self.process.stdin:
            return -1

        self.msg_id += 1
        payload = {
            "jsonrpc": "2.0",
            "method": method
        }
        if not is_notification:
            payload["id"] = self.msg_id
        if params is not None:
            payload["params"] = params

        body = json.dumps(payload).encode('utf-8')
        header = f"Content-Length: {len(body)}\r\n\r\n".encode('utf-8')
        
        try:
            self.process.stdin.write(header + body)
            await self.process.stdin.drain()
        except Exception as e:
            print(f"[LSP] Send RPC error: {e}")

        return self.msg_id

    async def _initialize(self):
        root_uri = f"file:///{self.workspace_dir.replace('\\', '/')}"
        init_params = {
            "processId": os.getpid(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "publishDiagnostics": {"relatedInformation": True}
                }
            }
        }
        await self._send_rpc("initialize", init_params)
        await asyncio.sleep(0.1)
        await self._send_rpc("initialized", {}, is_notification=True)

    async def _read_responses(self):
        if not self.process or not self.process.stdout:
            return

        reader = self.process.stdout
        while not reader.at_eof():
            try:
                line = await reader.readline()
                if not line:
                    break

                line_str = line.decode('utf-8', errors='ignore')
                if line_str.startswith('Content-Length:'):
                    content_length = int(line_str.split(':')[1].strip())
                    # Skip empty lines until body
                    while True:
                        header_line = await reader.readline()
                        if header_line in (b'\r\n', b'\n', b''):
                            break
                    
                    body_bytes = await reader.readexactly(content_length)
                    data = json.loads(body_bytes.decode('utf-8', errors='ignore'))
                    
                    if data.get('method') == 'textDocument/publishDiagnostics':
                        params = data.get('params', {})
                        uri = params.get('uri', '')
                        diags = params.get('diagnostics', [])
                        # Standardize URI key
                        norm_uri = os.path.abspath(uri.replace('file:///', '').replace('/', os.sep))
                        self.diagnostics_cache[norm_uri] = diags
            except asyncio.IncompleteReadError:
                break
            except Exception as e:
                print(f"[LSP] Reader error: {e}")
                await asyncio.sleep(0.05)

    async def check_diagnostics(self, file_path: str, timeout: float = 1.5) -> List[str]:
        abs_path = os.path.abspath(file_path)
        if not await self.start_server(abs_path):
            return []

        file_uri = f"file:///{abs_path.replace('\\', '/')}"
        try:
            with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            open_params = {
                "textDocument": {
                    "uri": file_uri,
                    "languageId": "python" if self.server_type == "python" else "typescript",
                    "version": 1,
                    "text": content
                }
            }
            await self._send_rpc("textDocument/didOpen", open_params, is_notification=True)
            
            # Wait briefly for LSP server to publish diagnostics
            start_time = asyncio.get_event_loop().time()
            while (asyncio.get_event_loop().time() - start_time) < timeout:
                if abs_path in self.diagnostics_cache:
                    break
                await asyncio.sleep(0.1)

            raw_diags = self.diagnostics_cache.get(abs_path, [])
            formatted = []
            for d in raw_diags:
                severity = d.get('severity', 1)
                # Filter for Errors (Severity 1) and Warnings (Severity 2)
                if severity <= 2:
                    range_info = d.get('range', {}).get('start', {})
                    line = range_info.get('line', 0) + 1
                    msg = d.get('message', 'Syntax/Type Error')
                    prefix = "ERROR" if severity == 1 else "WARNING"
                    formatted.append(f"Line {line}: [{prefix}] {msg}")
            
            return formatted
        except Exception as e:
            print(f"[LSP] Check diagnostics error for {file_path}: {e}")
            return []

    async def shutdown(self):
        if self.process:
            try:
                await self._send_rpc("shutdown")
                await self._send_rpc("exit", is_notification=True)
                self.process.terminate()
            except Exception:
                pass
            self.process = None


# Global active LSP instances indexed by workspace directory
_active_lsp_clients: Dict[str, LSPClient] = {}

def get_lsp_client(workspace_dir: str) -> LSPClient:
    norm_dir = os.path.abspath(workspace_dir)
    if norm_dir not in _active_lsp_clients:
        _active_lsp_clients[norm_dir] = LSPClient(norm_dir)
    return _active_lsp_clients[norm_dir]
