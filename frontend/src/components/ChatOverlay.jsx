import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { Send, Mic, MicOff, RefreshCw, MessageSquare, X, Terminal, Cpu, Sparkles, Monitor, Music, Film, File, ExternalLink, Copy, Check, Globe, Code, Sliders, Database, Eye, FileText, Folder, Brain, Wrench, Paperclip } from 'lucide-react';
import { ANIMATIONS } from '../animationsRegistry';
import { API_BASE } from '../api';
import { SLASH_COMMANDS } from '../constants';

const getFileIcon = (fileNameOrPath) => {
  if (!fileNameOrPath) return <FileText style={{ width: '12px', height: '12px', color: '#94a3b8' }} />;
  const ext = fileNameOrPath.split('.').pop().toLowerCase();
  if (["js", "ts", "jsx", "tsx", "py", "c", "cpp", "java", "cs", "rb", "go", "rs"].includes(ext)) {
    return <Code style={{ width: '12px', height: '12px', color: '#a78bfa' }} />;
  }
  if (["css", "scss", "sass", "less"].includes(ext)) {
    return <Sliders style={{ width: '12px', height: '12px', color: '#38bdf8' }} />;
  }
  if (["html", "htm"].includes(ext)) {
    return <Globe style={{ width: '12px', height: '12px', color: '#38bdf8' }} />;
  }
  if (["json", "yaml", "yml", "toml", "db", "sqlite", "env"].includes(ext)) {
    return <Database style={{ width: '12px', height: '12px', color: '#f59e0b' }} />;
  }
  if (["png", "jpg", "jpeg", "svg", "webp", "gif", "ico", "bmp"].includes(ext)) {
    return <Eye style={{ width: '12px', height: '12px', color: '#4ade80' }} />;
  }
  return <FileText style={{ width: '12px', height: '12px', color: '#94a3b8' }} />;
};

export const parseMessageThought = (rawContent) => {
  if (!rawContent || typeof rawContent !== 'string') {
    return { thoughts: [], toolBadges: [], cleanContent: rawContent || '' };
  }
  const thoughts = [];
  const toolBadges = [];

  // 1. Parse <thought>/<think>/<reasoning>
  const thoughtRegex = /<(thought|think|reasoning)>([\s\S]*?)(?:<\/\1>|$)/gi;
  let match;
  let cleanContent = rawContent;
  while ((match = thoughtRegex.exec(rawContent)) !== null) {
    const thoughtText = match[2].trim();
    if (thoughtText) {
      thoughts.push(thoughtText);
    }
  }
  cleanContent = cleanContent.replace(/<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)/gi, '').trim();

  // 2. Parse tool badges e.g.: 🛠️ **[jarvis_run_terminal (`dir...`) — ✓ Done]**\n```tool_args\n...\n```\n```tool_output\nOutput text...\n```
  const toolRegex = /🛠️\s*\*{0,2}\[([a-zA-Z0-9_]+)(?:\s*\((.*?)\))?\s*—\s*([^\]]+)\]\*{0,2}(?:\s*```tool_args\n([\s\S]*?)\n```)?(?:\s*```(?:tool_output|terminal_stream)\n([\s\S]*?)\n```)?/g;
  while ((match = toolRegex.exec(cleanContent)) !== null) {
    toolBadges.push({
      toolName: match[1],
      target: match[2] ? match[2].replace(/^`|`$/g, '').trim() : '',
      status: match[3],
      args: match[4] ? match[4].trim() : '',
      output: match[5] ? match[5].trim() : ''
    });
  }

  // Strip raw tool badge lines, args blocks, & output blocks from clean text content
  cleanContent = cleanContent.replace(/🛠️\s*\*{0,2}\[[^\]]+\]\*{0,2}(?:\s*```tool_args\n[\s\S]*?\n```)?(?:\s*```(?:tool_output|terminal_stream)\n[\s\S]*?\n```)?\n?/g, '').trim();

  return { thoughts, toolBadges, cleanContent };
};

const handleOpenFileInSidebar = (filePath) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('yuki:open-file', { detail: { path: filePath } }));
  }
};

const handleOpenFolderInSidebar = (folderPath) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('yuki:open-folder', { detail: { path: folderPath } }));
  }
};

export const openExternalUrl = (url) => {
  if (!url) return;
  const target = url.startsWith('www.') ? `https://${url}` : url;
  if (window.electronAPI?.openExternalUrl) {
    window.electronAPI.openExternalUrl(target);
  } else {
    window.open(target, '_blank', 'noopener,noreferrer');
  }
};

export const formatMessageText = (text, disableFileLinks = false) => {
  if (!text || typeof text !== 'string') return text || '';

  if (disableFileLinks) {
    // In File Viewer mode: render standard inline code & bold text, no pill buttons!
    const inlineRegex = /`([^`]+)`|\*\*([^*]+)\*\*/gi;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = inlineRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      if (match[1]) {
        parts.push(
          <code key={match.index} style={{ fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.85em', background: 'rgba(255, 255, 255, 0.12)', padding: '2px 6px', borderRadius: '4px', color: '#2dd4bf' }}>
            {match[1]}
          </code>
        );
      } else if (match[2]) {
        parts.push(
          <strong key={match.index} style={{ fontWeight: '700', color: '#e2e8f0' }}>
            {match[2]}
          </strong>
        );
      }
      lastIndex = inlineRegex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  }
  
  // Regex matches:
  // 1. Markdown Links: [label](url_or_path)
  // 2. HTTP/HTTPS URLs: https://... or http://... or www....
  // 3. Windows File Paths (with ext): D:\path\to\file.ext
  // 4. file:/// URIs
  // 5. Windows Folder Paths (no ext): D:\path\to\folder
  // 6. Code block `code` & Bold **bold**
  const linkOrPathRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+|www\.[^\)]+|file:\/\/\/?[^\)]+|[A-Za-z]:[\\\/][^\)]+)\)|(https?:\/\/[^\s\(\)<>"'\`\n]+|www\.[^\s\(\)<>"'\`\n]+)|([A-Za-z]:[\\\/][^:\*\?"'\`<>\|\s\n\(\)\[\]{}]+?\.(?:md|js|py|json|css|html|ts|jsx|tsx|png|jpg|jpeg|svg|webp|gif|txt|log|cpp|c|cs|java|db|pyc))|(file:\/\/\/[^:\*\?"'\`<>\|\s\n\(\)\[\]{}]+?\.(?:md|js|py|json|css|html|ts|jsx|tsx|png|jpg|jpeg|svg|webp|gif|txt|log|cpp|c|cs|java|db|pyc))|([A-Za-z]:[\\\/][^:\*\?"'\`<>\|\s\n\(\)\[\]{}]+)|`([^`]+)`|\*\*([^*]+)\*\*/gi;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = linkOrPathRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }
    lastIndex = linkOrPathRegex.lastIndex;

    // Don't make pills out of URL/path text wrapped in quotes or backticks
    const beforeChar = text[matchIndex - 1];
    const afterChar = text[lastIndex];
    const isQuoteWrapped =
      (beforeChar === '"' && afterChar === '"') ||
      (beforeChar === "'" && afterChar === "'") ||
      (beforeChar === '`' && afterChar === '`');

    if (isQuoteWrapped) {
      parts.push(text.substring(matchIndex, lastIndex));
      continue;
    }

    if (match[1] && match[2]) {
      // Markdown link: [label](target)
      const label = match[1];
      const target = match[2];
      const isUrl = /^https?:\/\//i.test(target) || /^www\./i.test(target);
      const isFile = !isUrl && (/\.[a-zA-Z0-9]{1,8}$/.test(label) || /\.[a-zA-Z0-9]{1,8}$/.test(target));

      if (isUrl) {
        parts.push(
          <button
            key={matchIndex}
            type="button"
            onClick={() => openExternalUrl(target)}
            title={`Click to open ${target} in external web browser`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            <Globe style={{ width: '12px', height: '12px', color: '#38bdf8' }} />
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{label}</span>
            <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
          </button>
        );
      } else if (isFile) {
        const rawPath = target.replace(/^file:\/\/\/?/, '').replace(/\//g, '\\');
        parts.push(
          <button
            key={matchIndex}
            type="button"
            onClick={() => handleOpenFileInSidebar(rawPath)}
            title={`Click to open ${rawPath} in File Inspector`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(167, 139, 250, 0.15)',
              border: '1px solid rgba(167, 139, 250, 0.35)',
              color: '#c4b5fd',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            {getFileIcon(label || target)}
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{label}</span>
            <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
          </button>
        );
      } else {
        // Folder path markdown link
        const rawPath = target.replace(/^file:\/\/\/?/, '').replace(/\//g, '\\');
        parts.push(
          <button
            key={matchIndex}
            type="button"
            onClick={() => handleOpenFolderInSidebar(rawPath)}
            title={`Click to open directory ${rawPath} in File Viewer`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#fbbf24',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            <Folder style={{ width: '12px', height: '12px', color: '#f59e0b' }} />
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{label}</span>
            <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
          </button>
        );
      }
    } else if (match[3]) {
      // Raw Web URL
      const rawUrl = match[3];
      parts.push(
        <button
          key={matchIndex}
          type="button"
          onClick={() => openExternalUrl(rawUrl)}
          title={`Click to open ${rawUrl} in external web browser`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '6px',
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: '#38bdf8',
            fontSize: '0.76rem',
            fontWeight: 600,
            cursor: 'pointer',
            margin: '0 3px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
          }}
        >
          <Globe style={{ width: '12px', height: '12px', color: '#38bdf8' }} />
          <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{rawUrl}</span>
          <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
        </button>
      );
    } else if (match[4] || match[5]) {
      // Raw Windows or file:/// File path string
      const rawPath = (match[4] || match[5]).replace(/^file:\/\/\/?/, '').replace(/\//g, '\\');
      const fileName = rawPath.split('\\').pop() || rawPath;

      parts.push(
        <button
          key={matchIndex}
          type="button"
          onClick={() => handleOpenFileInSidebar(rawPath)}
          title={`Click to open ${rawPath} in File Inspector`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '6px',
            background: 'rgba(167, 139, 250, 0.15)',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            color: '#c4b5fd',
            fontSize: '0.76rem',
            fontWeight: 600,
            cursor: 'pointer',
            margin: '0 3px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
          }}
        >
          {getFileIcon(fileName)}
          <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{fileName}</span>
          <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
        </button>
      );
    } else if (match[6]) {
      // Raw Windows Folder path string (no file extension)
      const rawPath = match[6].replace(/\//g, '\\');
      const folderName = rawPath.split('\\').pop() || rawPath;

      parts.push(
        <button
          key={matchIndex}
          type="button"
          onClick={() => handleOpenFolderInSidebar(rawPath)}
          title={`Click to open directory ${rawPath} in File Viewer`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '6px',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: '#fbbf24',
            fontSize: '0.76rem',
            fontWeight: 600,
            cursor: 'pointer',
            margin: '0 3px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
          }}
        >
          <Folder style={{ width: '12px', height: '12px', color: '#f59e0b' }} />
          <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{folderName}</span>
          <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
        </button>
      );
    } else if (match[7]) {
      // Code block `code`
      const codeContent = match[7].trim();
      const fileMatch = codeContent.match(/^([A-Za-z]:[\\\/][^\s\(\)<>"'\n]+?\.(?:md|js|py|json|css|html|ts|jsx|tsx|png|jpg|jpeg|svg|webp|gif|txt|log|cpp|c|cs|java|db|pyc)|file:\/\/\/[^\s\(\)<>"'\n]+?\.(?:md|js|py|json|css|html|ts|jsx|tsx|png|jpg|jpeg|svg|webp|gif|txt|log|cpp|c|cs|java|db|pyc))$/i);
      const folderMatch = !fileMatch && codeContent.match(/^([A-Za-z]:[\\\/][^\s\:\*\?"<>\|\n\(\)\[\]{}]+)$/i);
      const urlMatch = codeContent.match(/^(https?:\/\/[^\s\(\)<>"'\n]+|www\.[^\s\(\)<>"'\n]+)$/i);

      if (urlMatch) {
        const rawUrl = urlMatch[1];
        parts.push(
          <button
            key={matchIndex}
            type="button"
            onClick={() => window.open(rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl, '_blank', 'noopener,noreferrer')}
            title={`Click to open ${rawUrl} in browser`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            <Globe style={{ width: '12px', height: '12px', color: '#38bdf8' }} />
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{rawUrl}</span>
            <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
          </button>
        );
      } else if (fileMatch) {
        const rawPath = fileMatch[1].replace(/^file:\/\/\/?/, '').replace(/\//g, '\\');
        const fileName = rawPath.split('\\').pop() || rawPath;
        parts.push(
          <button
            key={matchIndex}
            type="button"
            onClick={() => handleOpenFileInSidebar(rawPath)}
            title={`Click to open ${rawPath} in File Inspector`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(167, 139, 250, 0.15)',
              border: '1px solid rgba(167, 139, 250, 0.35)',
              color: '#c4b5fd',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            {getFileIcon(fileName)}
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{fileName}</span>
            <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
          </button>
        );
      } else if (folderMatch) {
        const rawPath = folderMatch[1].replace(/\//g, '\\');
        const folderName = rawPath.split('\\').pop() || rawPath;
        parts.push(
          <button
            key={matchIndex}
            type="button"
            onClick={() => handleOpenFolderInSidebar(rawPath)}
            title={`Click to open directory ${rawPath} in File Viewer`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#fbbf24',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            <Folder style={{ width: '12px', height: '12px', color: '#f59e0b' }} />
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{folderName}</span>
            <ExternalLink style={{ width: '10px', height: '10px', opacity: 0.8 }} />
          </button>
        );
      } else {
        parts.push(
          <code
            key={matchIndex}
            style={{
              fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
              fontSize: '0.85em',
              background: 'rgba(255, 255, 255, 0.12)',
              padding: '2px 6px',
              borderRadius: '4px',
              color: '#2dd4bf',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              margin: '0 2px'
            }}
          >
            {codeContent}
          </code>
        );
      }
    } else if (match[8]) {
      // Bold **bold**
      parts.push(
        <strong
          key={matchIndex}
          style={{
            fontWeight: '700',
            color: '#e2e8f0'
          }}
        >
          {match[8]}
        </strong>
      );
    }
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

// Helper to format tool names cleanly
export const formatToolName = (toolRaw) => {
  if (!toolRaw) return "System Tool";
  const name = toolRaw.replace(/['"\s]/g, '').toLowerCase();

  if (name.includes('open_or_play') || name.includes('play_file')) return "🎬 Open Or Play File";
  if (name.includes('query_file') || name.includes('search_files') || name.includes('queryfile') || name.includes('file_db')) return "🗄️ DB File Search";
  if (name.includes('read_file') || name.includes('read_and_review')) return "📄 Read File";
  if (name.includes('create_or_edit') || name.includes('write_file')) return "✏️ Write File";
  if (name.includes('web_search')) return "🌐 Web Search";
  if (name.includes('web_scrape') || name.includes('scrape_web')) return "📰 Web Scraper";
  if (name.includes('system_diagnostics') || name.includes('get_system_stats')) return "💻 System Diagnostics";
  if (name.includes('list_dir') || name.includes('list_directory')) return "🌳 List Directory";
  if (name.includes('git_status')) return "🌿 Git Status";
  if (name.includes('manage_time')) return "⏰ Timer & Clock";
  if (name.includes('set_system_volume')) return "🔊 Volume Control";
  if (name.includes('launch_app')) return "🚀 Launch App";

  return toolRaw.replace(/^jarvis_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export const extractToolArgsString = (text) => {
  if (!text) return "";
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    return ` (${parenMatch[1]})`;
  }
  return "";
};

export const AgenticToolTimelineItem = ({ content }) => {
  const text = content || "";
  const isStart = text.includes("⚙️ [Tool Start]");
  const isResult = text.includes("⚙️ [Tool Result]");

  if (isStart) {
    const match = text.match(/Running tool ['"]?([^'"]+)['"]?/i);
    const rawTool = match ? match[1] : "";
    const toolLabel = formatToolName(rawTool);
    const argsStr = extractToolArgsString(text);

    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 12px',
        borderRadius: '20px',
        background: 'rgba(45, 212, 191, 0.08)',
        border: '1px solid rgba(45, 212, 191, 0.22)',
        fontSize: '0.66rem',
        color: '#2dd4bf',
        backdropFilter: 'blur(4px)',
        margin: '4px 0'
      }}>
        <span style={{ fontSize: '0.70rem' }}>⚙️</span>
        <span style={{ fontWeight: 600 }}>Executing: {toolLabel}</span>
        {argsStr && <span style={{ opacity: 0.85, color: '#99f6e4', fontSize: '0.62rem', fontFamily: 'monospace' }}>{argsStr}</span>}
      </div>
    );
  }

  if (isResult) {
    const cleanResult = text.replace(/⚙️\s*\[Tool Result\]\s*/i, '').trim();
    const firstLine = cleanResult.split('\n')[0] || "Tool execution completed";

    return (
      <div style={{ margin: '3px 0', width: '100%', maxWidth: '90%', display: 'flex', justifyContent: 'center' }}>
        <details style={{
          width: '100%',
          background: 'rgba(15, 23, 42, 0.55)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '8px',
          padding: '4px 10px',
          fontSize: '0.66rem',
          color: '#38bdf8',
          backdropFilter: 'blur(6px)'
        }}>
          <summary style={{
            cursor: 'pointer',
            fontWeight: 600,
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            outline: 'none',
            whiteSpace: 'nowrap'
          }}>
            <span style={{ fontSize: '0.70rem', color: '#10b981' }}>✓</span>
            <span style={{ fontWeight: 700, color: '#38bdf8' }}>Result:</span>
            <span style={{
              fontSize: '0.64rem',
              color: '#e2e8f0',
              opacity: 0.9,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '260px'
            }}>
              {firstLine}
            </span>
            <span style={{ fontSize: '0.58rem', opacity: 0.5, color: '#94a3b8', marginLeft: 'auto', flexShrink: 0 }}>
              (click to expand)
            </span>
          </summary>
          <div style={{
            marginTop: '5px',
            paddingTop: '5px',
            borderTop: '1px solid rgba(56, 189, 248, 0.15)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '0.64rem',
            color: '#cbd5e1',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '140px',
            overflowY: 'auto',
            lineHeight: '1.4'
          }}>
            {cleanResult}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div style={{
      margin: '2px 0',
      padding: '3px 10px',
      borderRadius: '12px',
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      fontSize: '0.66rem',
      color: '#94a3b8'
    }}>
      {text}
    </div>
  );
};

export const CodeBlockCopyButton = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: copied ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 255, 255, 0.06)',
        border: `1px solid ${copied ? 'rgba(74, 222, 128, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
        borderRadius: '4px',
        padding: '2px 8px',
        color: copied ? '#4ade80' : '#94a3b8',
        fontSize: '0.66rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease'
      }}
    >
      {copied ? <Check style={{ width: '11px', height: '11px', color: '#4ade80' }} /> : <Copy style={{ width: '11px', height: '11px' }} />}
      <span>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
};

const isTableSeparatorLine = (line) => {
  const text = line.trim();
  if (!text) return false;
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text);
};

const splitTableRowCells = (line) => {
  const text = line.trim();
  const protectedText = text.replace(/\\\|/g, '\u0000');
  let cells = protectedText.split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.split('\u0000').join('|').trim());
};

const parseTableAlignments = (separatorLine) => {
  return splitTableRowCells(separatorLine).map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });
};

const renderMarkdownTable = (headerCells, aligns, rows, disableFileLinks, key) => {
  const alignStyle = (cIdx) => ({ textAlign: aligns[cIdx] || 'left' });
  return (
    <div key={key} style={{ overflowX: 'auto', margin: '6px 0', borderRadius: '8px', border: '1px solid rgba(56,189,248,0.2)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', color: '#cbd5e1' }}>
        <thead>
          <tr style={{ background: 'rgba(56,189,248,0.12)' }}>
            {headerCells.map((cell, cIdx) => (
              <th key={cIdx} style={{ padding: '6px 10px', ...alignStyle(cIdx), borderBottom: '1px solid rgba(56,189,248,0.35)', color: '#38bdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {formatMessageText(cell, disableFileLinks)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={rIdx} style={{ background: rIdx % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)' }}>
              {row.map((cell, cIdx) => (
                <td key={cIdx} style={{ padding: '5px 10px', ...alignStyle(cIdx), borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' }}>
                  {formatMessageText(cell, disableFileLinks)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const renderMarkdownTextLines = (lines, { isSystem = false, disableFileLinks = false, cleanContent = '' } = {}) => {
  const rendered = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed && i > 0 && i < lines.length - 1) {
      rendered.push(<div key={i} style={{ height: '3px' }} />);
      i++;
      continue;
    }

    // Markdown Table: current line has pipes and the next line is a separator row
    const nextTrimmed = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (line.includes('|') && isTableSeparatorLine(nextTrimmed)) {
      const headerCells = splitTableRowCells(line);
      const aligns = parseTableAlignments(lines[i + 1]);
      const rows = [];
      let r = i + 2;
      while (r < lines.length && lines[r].includes('|')) {
        rows.push(splitTableRowCells(lines[r]));
        r++;
      }
      rendered.push(renderMarkdownTable(headerCells, aligns, rows, disableFileLinks, `table-${i}`));
      i = r;
      continue;
    }

    // Horizontal Rule (---, ***, ___)
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      rendered.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(167, 139, 250, 0.25)', margin: '10px 0' }} />);
      i++;
      continue;
    }

    // Markdown Headers (#, ##, ###)
    if (trimmed.startsWith('### ')) {
      rendered.push(
        <h3 key={i} style={{ color: '#38bdf8', margin: '8px 0 3px', fontSize: '0.86rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '3px', height: '11px', background: '#38bdf8', borderRadius: '2px' }}></span>
          {formatMessageText(trimmed.replace(/^###\s+/, ''), disableFileLinks)}
        </h3>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      rendered.push(
        <h2 key={i} style={{ color: '#c4b5fd', borderBottom: '1px solid rgba(196, 181, 253, 0.2)', paddingBottom: '3px', margin: '10px 0 5px', fontSize: '0.94rem', fontWeight: 700 }}>
          {formatMessageText(trimmed.replace(/^##\s+/, ''), disableFileLinks)}
        </h2>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      rendered.push(
        <h1 key={i} style={{ color: '#38bdf8', borderBottom: '1px solid rgba(56, 189, 248, 0.25)', paddingBottom: '4px', margin: '12px 0 6px', fontSize: '1.05rem', fontWeight: 800 }}>
          {formatMessageText(trimmed.replace(/^#\s+/, ''), disableFileLinks)}
        </h1>
      );
      i++;
      continue;
    }

    // Blockquotes (> text)
    if (trimmed.startsWith('> ')) {
      rendered.push(
        <div key={i} style={{ borderLeft: '3px solid #a78bfa', background: 'rgba(139, 92, 246, 0.08)', padding: '4px 10px', margin: '4px 0', borderRadius: '0 6px 6px 0', color: '#c4b5fd', fontSize: '0.78rem', fontStyle: 'italic' }}>
          {formatMessageText(trimmed.replace(/^>\s+/, ''), disableFileLinks)}
        </div>
      );
      i++;
      continue;
    }

    // Calculate leading space indentation level for nested sub-points
    const nonSpaceIndex = line.search(/\S/);
    const leadingSpaces = nonSpaceIndex === -1 ? 0 : nonSpaceIndex;
    const indentLevel = Math.min(Math.floor(leadingSpaces / 2), 4);
    const paddingLeft = 4 + (indentLevel * 18);

    // Bullet lists (•, -, *)
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const bulletSymbol = indentLevel === 0 ? '•' : indentLevel === 1 ? '◦' : '▪';
      const bulletColor = indentLevel === 0 ? '#38bdf8' : indentLevel === 1 ? '#c4b5fd' : '#94a3b8';
      const fontSize = indentLevel === 0 ? '0.80rem' : indentLevel === 1 ? '0.78rem' : '0.76rem';

      rendered.push(
        <div key={i} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          paddingLeft: `${paddingLeft}px`,
          fontSize: fontSize,
          margin: '1px 0'
        }}>
          <span style={{ color: bulletColor, fontWeight: 700, flexShrink: 0 }}>{bulletSymbol}</span>
          <div style={{ wordBreak: 'break-word' }}>{formatMessageText(trimmed.replace(/^[•\-\*]\s+/, ''), disableFileLinks)}</div>
        </div>
      );
      i++;
      continue;
    }

    // Numbered lists (1. , 2. )
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      const numColor = indentLevel === 0 ? '#38bdf8' : indentLevel === 1 ? '#a78bfa' : '#94a3b8';
      const fontSize = indentLevel === 0 ? '0.80rem' : indentLevel === 1 ? '0.78rem' : '0.76rem';

      rendered.push(
        <div key={i} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          paddingLeft: `${paddingLeft}px`,
          fontSize: fontSize,
          margin: '1px 0'
        }}>
          <span style={{ color: numColor, fontWeight: 700, fontSize: '0.76rem', flexShrink: 0 }}>{numMatch[1]}.</span>
          <div style={{ wordBreak: 'break-word' }}>{formatMessageText(numMatch[2], disableFileLinks)}</div>
        </div>
      );
      i++;
      continue;
    }

    rendered.push(
      <div key={i} style={{ margin: '1px 0', lineHeight: '1.45' }}>
        {isSystem && i === 0 && !cleanContent.startsWith("⚙️") && <span style={{ color: 'var(--accent-teal)', fontWeight: 'bold', marginRight: '6px' }}>[SYSTEM]</span>}
        {formatMessageText(line, disableFileLinks)}
      </div>
    );
    i++;
  }
  return rendered;
};

export const renderMarkdownBlocks = (cleanContent, { isSystem = false, disableFileLinks = false } = {}) => {
  if (!cleanContent) return null;

  // Split by fenced code blocks: ```lang\ncode\n```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(cleanContent)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      blocks.push({ type: 'text', content: cleanContent.substring(lastIndex, matchIndex) });
    }

    const lang = match[1] ? match[1].trim() : 'text';
    const code = match[2];
    blocks.push({ type: 'code', lang, code });

    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < cleanContent.length) {
    blocks.push({ type: 'text', content: cleanContent.substring(lastIndex) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {blocks.map((block, bIdx) => {
        if (block.type === 'code') {
          return (
            <div key={`code-block-${bIdx}`} style={{ margin: '6px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#020617', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', background: 'rgba(15, 23, 42, 0.9)', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: '0.68rem', fontFamily: 'monospace' }}>
                <span style={{ fontWeight: 600, color: '#38bdf8', textTransform: 'uppercase' }}>{block.lang || 'code'}</span>
                <CodeBlockCopyButton code={block.code} />
              </div>
              <div style={{ overflowX: 'auto', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                <pre style={{ margin: 0, padding: '10px 12px', fontSize: '0.76rem', fontFamily: 'Consolas, Monaco, monospace', color: '#cbd5e1', whiteSpace: 'pre', wordBreak: 'normal', display: 'block', width: 'max-content', minWidth: '100%', boxSizing: 'border-box' }}>
                  {block.code}
                </pre>
              </div>
            </div>
          );
        }

        // Text block: parse line by line for headers, rules, blockquotes, lists, tables
        const lines = block.content.split('\n');
        return (
          <div key={`text-block-${bIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {renderMarkdownTextLines(lines, { isSystem, disableFileLinks, cleanContent })}
          </div>
        );
      })}
    </div>
  );
};

export const RenderMessageContent = ({ content, isSystem, disableFileLinks = false }) => {
  const { thoughts, toolBadges, cleanContent } = parseMessageThought(content || "");

  return (
    <div>
      {thoughts && thoughts.map((thought, idx) => (
        <details
          key={idx}
          style={{
            margin: '2px 0 6px 0',
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid rgba(139, 92, 246, 0.18)',
            borderRadius: '6px',
            padding: '2px 7px',
            fontSize: '0.66rem',
            color: '#a78bfa',
            maxWidth: '100%'
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: '500', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px', outline: 'none' }}>
            <span style={{ fontSize: '0.68rem' }}>🧠</span>
            <span style={{ fontWeight: 600, color: '#c084fc' }}>Thought Process</span>
            <span style={{ fontSize: '0.60rem', opacity: 0.5, marginLeft: 'auto' }}>(click to toggle)</span>
          </summary>
          <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid rgba(139, 92, 246, 0.12)', fontStyle: 'italic', fontSize: '0.72rem', color: '#cbd5e1', whiteSpace: 'pre-line', lineHeight: '1.35', maxHeight: '160px', overflowY: 'auto' }}>
            {thought}
          </div>
        </details>
      ))}

      {/* Persistent collapsible tool-run cards so tool activity survives reloads */}
      {toolBadges && toolBadges.map((tb, bIdx) => {
        const isRunning = tb.status.includes('Running') || tb.status.includes('Processing');
        const isSuccess = tb.status.includes('Done') || tb.status.includes('Success') || tb.status.includes('Completed');
        const isFailed = !isRunning && !isSuccess;
        const statusBadgeBg = isRunning ? 'rgba(56, 189, 248, 0.15)' : isSuccess ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)';
        const statusBadgeColor = isRunning ? '#38bdf8' : isSuccess ? '#4ade80' : '#f87171';
        const statusBadgeBorder = isRunning ? 'rgba(56, 189, 248, 0.4)' : isSuccess ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)';
        const statusLabel = isRunning ? '⏳ Processing...' : isSuccess ? '✓ Completed' : '❌ Failed';

        return (
          <details
            key={bIdx}
            open={isRunning}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              margin: '3px 0 6px 0',
              background: 'rgba(15, 23, 42, 0.85)',
              border: `1px solid ${statusBadgeBorder}`,
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            <summary style={{
              cursor: 'pointer',
              padding: '6px 10px',
              background: 'rgba(30, 41, 59, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.70rem',
              fontWeight: 600,
              color: '#38bdf8',
              userSelect: 'none',
              boxSizing: 'border-box'
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🛠️ Tool Run: <strong>{tb.toolName}</strong>
              </span>
              <span style={{
                fontSize: '0.64rem',
                padding: '1px 8px',
                borderRadius: '4px',
                background: statusBadgeBg,
                color: statusBadgeColor,
                border: `1px solid ${statusBadgeBorder}`,
                flexShrink: 0
              }}>
                {statusLabel}
              </span>
            </summary>
            <div style={{ padding: '8px 10px', fontSize: '0.70rem', background: '#090d16', color: '#cbd5e1', fontFamily: 'monospace', boxSizing: 'border-box', overflowX: 'auto' }}>
              {tb.target && (
                <div style={{ color: '#94a3b8', marginBottom: '5px', fontSize: '0.68rem', wordBreak: 'break-all' }}>
                  <strong style={{ color: '#a78bfa' }}>Target / Command:</strong> {tb.target}
                </div>
              )}
              {tb.args && (
                <div style={{ marginTop: '5px', marginBottom: '6px' }}>
                  <div style={{ color: '#38bdf8', fontSize: '0.66rem', fontWeight: 700, marginBottom: '3px' }}>
                    📥 INPUT / ARGUMENTS:
                  </div>
                  <div style={{ background: '#020617', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.2)', maxHeight: '200px', overflow: 'auto', fontSize: '0.68rem', color: '#cbd5e1' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre', fontFamily: 'Consolas, Monaco, monospace' }}>{tb.args}</pre>
                  </div>
                </div>
              )}
              {tb.output && (
                <div style={{ marginTop: '5px', marginBottom: '5px' }}>
                  <div style={{ color: '#64748b', fontSize: '0.66rem', fontWeight: 600, marginBottom: '3px' }}>
                    📤 RESULT / OUTPUT:
                  </div>
                  <div style={{ background: '#020617', padding: '6px 8px', borderRadius: '6px', border: '1px solid #1e293b', maxHeight: '200px', overflow: 'auto', fontSize: '0.68rem', color: isFailed ? '#f87171' : '#4ade80' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre', fontFamily: 'Consolas, Monaco, monospace' }}>{tb.output}</pre>
                  </div>
                </div>
              )}
            </div>
          </details>
        );
      })}

      {cleanContent && renderMarkdownBlocks(cleanContent, { isSystem, disableFileLinks })}
    </div>
  );
};

export const getAttachmentSrc = (att) => {
  if (!att) return '';
  if (att.data_url) return att.data_url;
  if (att.save_path) return `${API_BASE}/api/chat/attachments/file?path=${encodeURIComponent(att.save_path)}`;
  return '';
};

export const renderMessageAttachments = (attachments, maxHeight = 220) => {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
      {attachments.map((att, idx) => {
        if (!att) return null;
        const src = getAttachmentSrc(att);
        if (att.is_image) {
          return (
            <img
              key={idx}
              src={src}
              alt={att.filename || 'attachment'}
              title={att.filename || 'attachment'}
              style={{
                width: 'auto',
                height: 'auto',
                maxWidth: '100%',
                maxHeight: `${maxHeight}px`,
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.15)',
                objectFit: 'contain',
                background: '#020617',
                cursor: src ? 'pointer' : 'default'
              }}
              onClick={() => { if (src) window.open(src, '_blank', 'noopener,noreferrer'); }}
            />
          );
        }
        return (
          <div
            key={idx}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.72rem',
              background: 'rgba(167, 139, 250, 0.18)',
              border: '1px solid rgba(167, 139, 250, 0.4)',
              color: '#c4b5fd'
            }}
          >
            <FileText style={{ width: '12px', height: '12px', flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{att.filename || 'Attachment'}</span>
          </div>
        );
      })}
    </div>
  );
};

const ChatOverlay = ({
  messages,
  inputText,
  setInputText,
  onSubmit,
  isListening,
  isTalkMode,
  toggleListening,
  onReset,
  isThinking,
  currentSpeechText,
  isPanelOpen,
  setIsPanelOpen,
  muteVoice,
  setMuteVoice,
  disabledAnimations = [],
  attachments = [],
  onUploadAttachments,
  onRemoveAttachment,
  isUploadingAttachment = false
}) => {
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Unified suggestions state ──────────────────────────────────────────────
  const [activeSuggIdx, setActiveSuggIdx] = useState(-1);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchMode, setSearchMode] = useState(null); // 'open' | 'play' | null
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // 1. Local Slash Command Suggestions
  const suggestions = useMemo(() => {
    if (!inputText.startsWith('/')) return [];
    const q = inputText.toLowerCase();
    return SLASH_COMMANDS.filter(({ cmd, animName }) => {
      if (animName && disabledAnimations.includes(animName)) return false;
      return cmd.startsWith(q);
    });
  }, [inputText, disabledAnimations]);

  // 2. Search Mode & Query Parsing
  const parsedSearch = useMemo(() => {
    const trimmed = inputText.trimStart();
    const openMatch = trimmed.match(/^\/(open|o)\s+(.*)/i);
    const playMatch = trimmed.match(/^\/(play|p)\s+(.*)/i);
    const readMatch = trimmed.match(/^\/(read)\s+(.*)/i);
    const sumMatch = trimmed.match(/^\/(sum)\s+(.*)/i);
    if (openMatch) {
      return { type: 'open', query: openMatch[2] };
    }
    if (playMatch) {
      return { type: 'play', query: playMatch[2] };
    }
    if (readMatch) {
      return { type: 'read', query: readMatch[2] };
    }
    if (sumMatch) {
      return { type: 'sum', query: sumMatch[2] };
    }
    return null;
  }, [inputText]);

  // 3. Dynamic Suggestions Fetch
  useEffect(() => {
    if (!parsedSearch) {
      setSearchSuggestions([]);
      setSearchMode(null);
      setSearchQuery('');
      setIsLoadingSuggestions(false);
      return;
    }

    const { type, query } = parsedSearch;
    setSearchMode(type);
    setSearchQuery(query);

    if (!query.trim()) {
      setSearchSuggestions([]);
      setIsLoadingSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);

    const controller = new AbortController();
    const signal = controller.signal;

    const delayDebounceFn = setTimeout(() => {
      fetch(`${API_BASE}/api/system/suggestions?query=${encodeURIComponent(query)}&type=${type}`, { signal })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch suggestions');
          return res.json();
        })
        .then((data) => {
          if (data && data.suggestions) {
            setSearchSuggestions(data.suggestions);
          } else {
            setSearchSuggestions([]);
          }
          setIsLoadingSuggestions(false);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('Error fetching suggestions:', err);
            setIsLoadingSuggestions(false);
          }
        });
    }, 200);

    return () => {
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [parsedSearch]);

  // 4. Unified Suggestions List
  const activeSuggestions = useMemo(() => {
    return searchMode ? searchSuggestions : suggestions;
  }, [searchMode, searchSuggestions, suggestions]);

  const showDropdown = (suggestions.length > 0) || (searchMode !== null);

  // Reset highlighted index whenever the list changes
  useEffect(() => {
    setActiveSuggIdx(-1);
  }, [activeSuggestions.length]);

  // Focus the input box automatically when the chat overlay panel is opened
  useEffect(() => {
    if (isPanelOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isPanelOpen]);

  const pickSuggestion = (cmd) => {
    setInputText(cmd + ' ');
    setActiveSuggIdx(-1);
    inputRef.current?.focus();
  };

  const pickSearchSuggestion = (item) => {
    let cmdPrefix = '/open';
    if (searchMode === 'play') cmdPrefix = '/play';
    else if (searchMode === 'read') cmdPrefix = '/read';
    else if (searchMode === 'sum') cmdPrefix = '/sum';
    const pathVal = item.path.includes(' ') ? `"${item.path}"` : item.path;
    const newText = `${cmdPrefix} ${pathVal}`;
    setInputText(newText);
    setActiveSuggIdx(-1);
    
    // Submit the command immediately
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} };
      onSubmit(fakeEvent, newText, true);
    }, 50);
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || activeSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggIdx((i) => Math.min(i + 1, activeSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' || (e.key === 'Enter' && activeSuggIdx >= 0)) {
      e.preventDefault();
      if (searchMode) {
        pickSearchSuggestion(activeSuggestions[activeSuggIdx]);
      } else {
        pickSuggestion(activeSuggestions[activeSuggIdx].cmd);
      }
    } else if (e.key === 'Escape') {
      setInputText('');
    }
  };

  // Instant bottom-up scroll (0-jump, consistent with AgenticWorkspaceWindow).
  useLayoutEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  // Auto-scroll selected command suggestion into view
  useEffect(() => {
    if (dropdownRef.current && activeSuggIdx >= 0) {
      const activeEl = dropdownRef.current.querySelector(`[data-index="${activeSuggIdx}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeSuggIdx]);

  return (
    <div className="chat-overlay-container">
      
      {/* Floating Dialog Bubble (hovers near character, visible when she speaks) */}
      {currentSpeechText && (
        <div className="speech-bubble-floating glass-panel animate-fade-in">
          {/* Arrow pointing at character */}
          <div className="bubble-arrow"></div>
          
          <span className="bubble-tag">Yuki</span>
          <p className="bubble-text">{formatMessageText(currentSpeechText)}</p>
        </div>
      )}

      {/* Floating Thinking indicator */}
      {isThinking && !currentSpeechText && (
        <div className="thinking-floating glass-panel">
          <Cpu className="w-4 h-4 animate-spin" />
          <span>Yuki is reasoning...</span>
        </div>
      )}

      {/* Left Bottom Trigger for Panel */}
      <div className="panel-trigger-bottom">
        <button
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          className={`panel-trigger-button glass-panel ${isPanelOpen ? 'active' : ''}`}
          title="Toggle Chat Log"
        >
          <MessageSquare className="w-5 h-5" />
        </button>

        <button
          onClick={() => {
            if (window.electronAPI && window.electronAPI.openChatWindow) {
              window.electronAPI.openChatWindow();
            } else {
              const targetUrl = window.location.origin + window.location.pathname + '?mode=chat';
              window.open(targetUrl, 'YukiAgenticWorkspace', 'width=1100,height=820,resizable=yes');
            }
          }}
          className="panel-trigger-button glass-panel"
          title="Open Standalone Agentic Workspace Window"
          style={{ color: '#c4b5fd' }}
        >
          <ExternalLink className="w-4.5 h-4.5" />
        </button>

        <button
          onClick={onReset}
          className="panel-trigger-button reset glass-panel"
          title="Clear History"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Slide-out Sidebar Panel for logs/chat history */}
      <div
        className="slide-panel-right glass-panel"
        style={{
          transform: isPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          opacity: isPanelOpen ? 1 : 0
        }}
      >
        {/* Panel Header */}
        <div className="panel-header">
          <div className="panel-title-wrapper">
            <Terminal className="w-4.5 h-4.5 text-violet-400" />
            <h3 className="panel-title">Neural Conversation Log</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => {
                if (window.electronAPI && window.electronAPI.openChatWindow) {
                  window.electronAPI.openChatWindow();
                } else {
                  const targetUrl = window.location.origin + window.location.pathname + '?mode=chat';
                  window.open(targetUrl, 'YukiAgenticWorkspace', 'width=1100,height=820,resizable=yes');
                }
              }}
              className="panel-close-btn"
              title="Open in Standalone Agentic Workspace Window"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsPanelOpen(false)}
              className="panel-close-btn"
              title="Close Panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Message Log Scroll Container */}
        <div className="chat-scroll-area" ref={chatScrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty-state">
              <MessageSquare className="w-8 h-8 opacity-25" style={{ color: 'var(--text-muted)' }} />
              <p className="font-semibold text-sm">No records in connection buffer.</p>
              <p className="text-xs opacity-75">Say "Hello" or ask Yuki to do something!</p>
            </div>
          )}

          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';
            const isToolEvent = isSystem || (msg.content && (msg.content.includes('⚙️ [Tool Start]') || msg.content.includes('⚙️ [Tool Result]')));

            if (isToolEvent) {
              return (
                <div key={index} style={{ alignSelf: 'center', width: '100%', display: 'flex', justifyContent: 'center', margin: '2px 0' }}>
                  <AgenticToolTimelineItem content={msg.content} />
                </div>
              );
            }

            return (
              <div
                key={index}
                className={`chat-bubble-wrapper ${isUser ? 'user' : 'assistant'}`}
              >
                {/* Sender badge + model flag */}
                {!isSystem && (() => {
                  const badgeStyles = {
                    gemini: {
                      background: 'linear-gradient(90deg, #7c3aed, #4f46e5)',
                      color: '#e0d7ff',
                      boxShadow: '0 0 8px rgba(124,58,237,0.4)',
                      label: 'Gemini',
                    },
                    qwen: {
                      background: 'linear-gradient(90deg, #0e7490, #0891b2)',
                      color: '#cffafe',
                      boxShadow: '0 0 8px rgba(8,145,178,0.4)',
                      label: 'Qwen',
                    },
                    gemma: {
                      background: 'linear-gradient(90deg, #166534, #15803d)',
                      color: '#dcfce7',
                      boxShadow: '0 0 8px rgba(21,128,61,0.4)',
                      label: 'Gemma',
                    },
                    nemotron: {
                      background: 'linear-gradient(90deg, #76b900, #388e3c)',
                      color: '#e8f5e9',
                      boxShadow: '0 0 8px rgba(118,185,0,0.4)',
                      label: 'Nemotron',
                    },
                  };
                  const badge = !isUser && msg.backend ? badgeStyles[msg.backend] : null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="bubble-sender-title">
                        {isUser ? 'Master' : 'Yuki'}
                      </span>
                      {badge && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          fontSize: '10px',
                          fontWeight: '600',
                          padding: '1px 7px',
                          borderRadius: '999px',
                          background: badge.background,
                          color: badge.color,
                          letterSpacing: '0.03em',
                          boxShadow: badge.boxShadow,
                        }}>
                          <Sparkles style={{ width: '9px', height: '9px' }} />
                          {badge.label}
                        </span>
                      )}
                      {!isUser && msg.responseTime !== undefined && (
                        <span style={{
                          fontSize: '9px',
                          color: '#94a3b8',
                          marginLeft: '2px',
                          opacity: 0.85,
                          fontFamily: 'monospace'
                        }}>
                          {msg.responseTime}s
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* Speech Bubble */}
                <div
                  className={`bubble-content-block ${
                    isSystem ? 'system' : isUser ? 'user' : 'assistant'
                  }`}
                >
                  {isUser && msg.attachments && renderMessageAttachments(msg.attachments)}
                  <RenderMessageContent content={msg.content} isSystem={isSystem} />
                </div>
              </div>
            );
          })}

          {/* Thinking Status inside log */}
          {isThinking && (
            <div className="chat-bubble-wrapper assistant">
              <span className="bubble-sender-title">Yuki</span>
              <div className="bubble-content-block assistant thinking-bubble">
                <span className="thinking-dot" style={{ animationDelay: '0ms' }}></span>
                <span className="thinking-dot" style={{ animationDelay: '150ms' }}></span>
                <span className="thinking-dot" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          )}

        </div>

        {/* Input Bar */}
        <div style={{ position: 'relative' }}>
          {/* Slash Command Suggestion Dropdown */}
          {showDropdown && (
            <div
              ref={dropdownRef}
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '6px',
                background: 'rgba(15, 10, 30, 0.96)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                borderRadius: '10px',
                boxShadow: '0 -8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(139,92,246,0.1)',
                backdropFilter: 'blur(20px)',
                overflow: 'hidden',
                zIndex: 999,
                maxHeight: '280px',
                overflowY: 'auto',
              }}
            >
              {/* Header */}
              <div style={{
                padding: '6px 12px 4px',
                fontSize: '9px',
                fontWeight: '700',
                letterSpacing: '0.1em',
                color: 'rgba(139,92,246,0.7)',
                textTransform: 'uppercase',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span>{searchMode ? `${searchMode.toUpperCase()} SUGGESTIONS` : 'Commands'}</span>
                {isLoadingSuggestions && (
                  <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', textTransform: 'none' }}>
                    Searching...
                  </span>
                )}
              </div>

              {searchMode ? (
                // Search Suggestions Render
                searchQuery.trim() === '' ? (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                    Type to search {searchMode === 'play' ? 'songs and movies' : (searchMode === 'read' || searchMode === 'sum' ? 'document files' : 'apps and files')}...
                  </div>
                ) : (isLoadingSuggestions && searchSuggestions.length === 0) ? (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                    Scanning filesystem & database...
                  </div>
                ) : searchSuggestions.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                    No matching results.
                  </div>
                ) : (
                  searchSuggestions.map((item, idx) => (
                    <div
                      key={item.path}
                      data-index={idx}
                      onMouseDown={(e) => { e.preventDefault(); pickSearchSuggestion(item); }}
                      onMouseEnter={() => setActiveSuggIdx(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        background: activeSuggIdx === idx
                          ? 'rgba(139, 92, 246, 0.18)'
                          : 'transparent',
                        borderLeft: activeSuggIdx === idx
                          ? '3px solid rgba(139,92,246,0.85)'
                          : '3px solid transparent',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Icon */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '26px',
                        height: '26px',
                        borderRadius: '6px',
                        background: activeSuggIdx === idx ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.04)',
                        color: activeSuggIdx === idx ? '#c4b5fd' : 'rgba(255,255,255,0.5)',
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                      }}>
                        {item.type === 'app' ? (
                          <Monitor size={13} />
                        ) : (
                          /\.(mp3|wav|flac|ogg)$/i.test(item.path) ? (
                            <Music size={13} />
                          ) : /\.(mp4|mkv|webm|avi|mov)$/i.test(item.path) ? (
                            <Film size={13} />
                          ) : (
                            <File size={13} />
                          )
                        )}
                      </div>

                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        flex: 1,
                      }}>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: '600',
                          color: activeSuggIdx === idx ? '#ffffff' : '#e2e8f0',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                        }}>
                          {item.name}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          color: activeSuggIdx === idx ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          direction: 'rtl',
                          textAlign: 'left',
                        }}>
                          {item.path}
                        </span>
                      </div>

                      {/* Badge */}
                      <span style={{
                        fontSize: '9px',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        padding: '1.5px 5px',
                        borderRadius: '4px',
                        letterSpacing: '0.05em',
                        background: item.type === 'app' ? 'rgba(45,212,191,0.12)' : 'rgba(139,92,246,0.12)',
                        color: item.type === 'app' ? '#2dd4bf' : '#a78bfa',
                        border: item.type === 'app' ? '1px solid rgba(45,212,191,0.2)' : '1px solid rgba(139,92,246,0.2)',
                        flexShrink: 0,
                      }}>
                        {item.type}
                      </span>
                    </div>
                  ))
                )
              ) : (
                // Commands List Render
                suggestions.map(({ cmd, description }, idx) => (
                  <div
                    key={cmd}
                    data-index={idx}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(cmd); }}
                    onMouseEnter={() => setActiveSuggIdx(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '7px 12px',
                      cursor: 'pointer',
                      background: activeSuggIdx === idx
                        ? 'rgba(139, 92, 246, 0.18)'
                        : 'transparent',
                      borderLeft: activeSuggIdx === idx
                        ? '2px solid rgba(139,92,246,0.8)'
                        : '2px solid transparent',
                      transition: 'background 0.1s, border-color 0.1s',
                    }}
                  >
                    <span style={{
                      fontFamily: 'Consolas, monospace',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: activeSuggIdx === idx ? '#c4b5fd' : '#a78bfa',
                      minWidth: '130px',
                      flexShrink: 0,
                    }}>
                      {cmd}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: 'rgba(200, 200, 220, 0.55)',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}>
                      {description}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Attachment Chips Preview */}
          {attachments && attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 12px', background: 'rgba(15,23,42,0.9)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {attachments.map((att, aIdx) => (
                <div
                  key={`overlay_att_${aIdx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 8px',
                    borderRadius: '8px',
                    background: att.is_image ? 'rgba(56, 189, 248, 0.18)' : 'rgba(167, 139, 250, 0.18)',
                    border: att.is_image ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(167, 139, 250, 0.4)',
                    fontSize: '0.70rem',
                    color: att.is_image ? '#38bdf8' : '#c4b5fd'
                  }}
                >
                  {att.is_image ? (
                    <img src={att.data_url} alt={att.filename} style={{ width: '18px', height: '18px', objectFit: 'cover', borderRadius: '3px' }} />
                  ) : (
                    <FileText style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                  )}
                  <span style={{ fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {att.filename}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment && onRemoveAttachment(aIdx)}
                    title="Remove attachment"
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 2px' }}
                  >
                    <X style={{ width: '12px', height: '12px' }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={onSubmit}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                onUploadAttachments && onUploadAttachments(e.dataTransfer.files);
              }
            }}
            className="input-form-row"
            style={{
              border: isDragOver ? '2px dashed #38bdf8' : undefined,
              borderRadius: isDragOver ? '14px' : undefined
            }}
          >
            <input
              type="file"
              ref={attachmentInputRef}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => onUploadAttachments && onUploadAttachments(e.target.files)}
            />

            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              disabled={isUploadingAttachment}
              title="Attach files or images"
              style={{
                background: isUploadingAttachment ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                padding: '6px 10px',
                color: isUploadingAttachment ? '#a78bfa' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onPaste={(e) => {
                if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                  e.preventDefault();
                  onUploadAttachments && onUploadAttachments(e.clipboardData.files);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={isDragOver ? "Drop files here to attach..." : "Type a command or message..."}
              className="glass-input"
            />
            <button type="submit" className="glass-button">
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Floating Bottom Center Audio Control Bar */}
      <div className="audio-control-hub glass-panel">
        <button
          onClick={toggleListening}
          className={`listen-toggle-btn ${
            isTalkMode ? (isListening ? 'active' : 'active talk-waiting') : ''
          }`}
          title={isTalkMode ? 'Click to exit Talk Mode' : 'Click to enter Talk Mode'}
        >
          {isTalkMode ? (
            isListening ? (
              <>
                <Mic className="w-4 h-4 text-teal-400" style={{ animation: 'pulse 1s infinite' }} />
                <span>Listening...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-amber-400" />
                <span>Talk Mode — Yuki speaking</span>
              </>
            )
          ) : (
            <>
              <MicOff className="w-4 h-4" />
              <span>Talk Mode</span>
            </>
          )}
        </button>

        <div className="divider-vertical"></div>

        <button
          onClick={() => setMuteVoice(!muteVoice)}
          className={`audio-mute-btn ${muteVoice ? 'muted' : ''}`}
          title={muteVoice ? 'Unmute Voice output' : 'Mute Voice output'}
        >
          {muteVoice ? 'Muted' : 'Voice On'}
        </button>
      </div>

    </div>
  );
};

export default ChatOverlay;
