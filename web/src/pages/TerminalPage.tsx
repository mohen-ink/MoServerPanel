import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { RefreshCw, TerminalSquare } from 'lucide-react';
import { StatusBadge } from '../components/UI';

export const TerminalPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [shell, setShell] = useState<'powershell' | 'cmd'>('powershell');
  const [connected, setConnected] = useState(false);
  const [sessionSeq, setSessionSeq] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        selectionBackground: 'rgba(99, 102, 241, 0.35)',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/terminal/ws?shell=${shell}&cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      } else {
        term.write(ev.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.writeln('\r\n\x1b[33m[连接已断开，点击右上角「重新连接」恢复会话]\x1b[0m');
    };

    const dataDisp = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      dataDisp.dispose();
      ws.close();
      term.dispose();
    };
  }, [shell, sessionSeq]);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <TerminalSquare className="w-5 h-5 text-indigo-400" /> 网页终端
          </h2>
          <StatusBadge active={connected} activeText="已连接" inactiveText="已断开" />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={shell}
            onChange={(e) => setShell(e.target.value as 'powershell' | 'cmd')}
            className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
          >
            <option value="powershell">PowerShell</option>
            <option value="cmd">CMD</option>
          </select>
          <button
            onClick={() => setSessionSeq((n) => n + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新连接
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-2xl bg-slate-950 border border-slate-800 p-3 overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
