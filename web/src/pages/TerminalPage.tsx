import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { RefreshCw } from 'lucide-react';
import { Button, PageHeader, Select, StatusBadge } from '../components/UI';

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
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0b0d12',
        foreground: '#e4e4e7',
        cursor: '#60a5fa',
        selectionBackground: 'rgba(96, 165, 250, 0.3)',
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
    <div className="flex flex-col h-[calc(100vh-6.5rem)]">
      <PageHeader
        className="mb-4"
        title="网页终端"
        extra={<StatusBadge active={connected} activeText="已连接" inactiveText="已断开" />}
        actions={
          <>
            <Select
              size="sm"
              wrapperClassName="w-36"
              value={shell}
              onChange={(e) => setShell(e.target.value as 'powershell' | 'cmd')}
            >
              <option value="powershell">PowerShell</option>
              <option value="cmd">CMD</option>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              onClick={() => setSessionSeq((n) => n + 1)}
            >
              重新连接
            </Button>
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-line overflow-hidden bg-[#0b0d12] shadow-card">
        <div className="h-9 px-4 flex items-center gap-2 border-b border-white/10 text-xs text-zinc-400 shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono">{shell === 'powershell' ? 'PowerShell' : 'CMD'}</span>
        </div>
        <div className="flex-1 min-h-0 p-3">
          <div ref={containerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
};
