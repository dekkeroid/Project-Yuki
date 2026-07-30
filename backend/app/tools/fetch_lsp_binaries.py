import os
import subprocess
import sys

def prepare_portable_lsp_binaries():
    """
    Pre-downloads and stages standalone JavaScript language server bundles
    (pyright and typescript-language-server) into backend/app/bin/lsp/
    so PyInstaller and Inno Setup package them for fresh target PCs.
    """
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    lsp_dir = os.path.join(backend_dir, 'app', 'bin', 'lsp')
    os.makedirs(lsp_dir, exist_ok=True)

    print(f"[LSP Stager] Preparing portable language servers in {lsp_dir}...")

    # Package list with version pins for stability
    npm_packages = [
        'pyright@1.1.411',
        'typescript-language-server@4.3.3',
        'typescript@5.3.3'
    ]

    try:
        # Initialize package.json if not present
        pkg_json = os.path.join(lsp_dir, 'package.json')
        if not os.path.exists(pkg_json):
            with open(pkg_json, 'w', encoding='utf-8') as f:
                f.write('{\n  "name": "yuki-portable-lsp",\n  "version": "1.0.0",\n  "private": true\n}\n')

        # Install standalone npm packages into backend/app/bin/lsp/node_modules
        cmd = ['npm.cmd' if sys.platform == 'win32' else 'npm', 'install', '--prefix', lsp_dir, '--ignore-scripts', '--no-audit', '--no-fund'] + npm_packages
        print(f"[LSP Stager] Running: {' '.join(cmd)}")
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=lsp_dir)
        
        if res.returncode == 0:
            print(f"[LSP Stager] Successfully staged portable language servers in {lsp_dir}!")
            return True
        else:
            print(f"[LSP Stager] NPM install warning: {res.stderr[:200]}")
            return False
    except Exception as e:
        print(f"[LSP Stager] Failed to stage LSP binaries: {e}")
        return False

if __name__ == '__main__':
    prepare_portable_lsp_binaries()
