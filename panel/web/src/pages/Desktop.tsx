import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useUI } from '../ui';

// 直接加载 KasmVNC 的 noVNC 页面（由 kclient 静态托管）。
// 反代按实例隔离：所有桌面流量走 /desktop/<id>/*，网关据 <id> 选目标容器并注入该实例凭据。
// path=desktop/<id>/websockify：让 noVNC 把 ws 连到该实例路径，网关剥前缀反代回 KasmVNC 根 /websockify。
function desktopUrl(id: string) {
  return (
    `/desktop/${id}/vnc/index.html?autoconnect=1&path=desktop/${id}/websockify&resize=remote` +
    '&reconnect=true&reconnect_delay=2000&clipboard_up=true&clipboard_down=true&clipboard_seamless=true'
  );
}

interface TFile {
  name: string;
  size: number;
}
function humanSize(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export default function Desktop() {
  const nav = useNavigate();
  const { toast } = useUI();
  const { id } = useParams<{ id: string }>();
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [files, setFiles] = useState<TFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // 文件拖到窗口任意位置时，弹出落区（覆盖 iframe，否则 drop 会被 iframe 吞掉）
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDropWin = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropWin);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropWin);
    };
  }, []);

  if (!id) {
    nav('/', { replace: true });
    return null;
  }

  const refreshFiles = async () => {
    try {
      const { files } = await api.listFiles(id);
      setFiles(files);
    } catch {
      /* ignore */
    }
  };

  const uploadFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setUploading(true);
    let ok = 0;
    for (const f of arr) {
      try {
        await api.uploadFile(id, f);
        ok++;
      } catch (e: any) {
        toast(`${f.name}: ${e.message || '上传失败'}`, 'error');
      }
    }
    setUploading(false);
    if (ok) {
      toast(`已上传 ${ok} 个文件到桌面，微信里可直接选取`, 'ok');
      refreshFiles();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    dragDepth.current = 0;
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div className="desktop-wrap">
      <iframe
        className="desktop-frame"
        src={desktopUrl(id)}
        title="电脑版微信"
        allow="clipboard-read; clipboard-write; microphone; camera; autoplay"
        onLoad={() => setLoaded(true)}
      />

      {!loaded && (
        <div className="desktop-loading">
          <div className="spinner" />
          <div className="desktop-loading-text">正在连接桌面…</div>
          <div className="desktop-loading-sub">首次进入请扫码登录微信</div>
          <div className="desktop-loading-sub">拖文件到窗口即可上传；语音/视频在左侧工具条开启</div>
          {!window.isSecureContext && (
            <div className="desktop-loading-warn">当前非 HTTPS 访问，浏览器将禁用麦克风与摄像头（音频播放不受影响）</div>
          )}
        </div>
      )}

      {/* 拖拽落区：仅拖入文件时出现，覆盖 iframe 接住 drop */}
      {dragging && (
        <div className="drop-zone" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <div className="drop-card">
            <div className="drop-icon">⬇</div>
            <div className="drop-title">松开上传到微信桌面</div>
            <div className="drop-sub">上传后在微信里「+ / 文件」选择即可</div>
          </div>
        </div>
      )}

      <button className="desktop-back" onClick={() => nav('/')} title="返回">
        ‹
      </button>

      {/* 文件按钮 */}
      <button
        className="desktop-files-btn"
        title="文件传输"
        onClick={() => {
          setShowFiles((v) => !v);
          if (!showFiles) refreshFiles();
        }}
      >
        ⇅
      </button>

      {showFiles && (
        <div className="files-panel">
          <div className="files-head">
            <span>文件传输</span>
            <button className="btn-text" onClick={() => setShowFiles(false)}>
              关闭
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button className="btn btn-primary files-upload" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? '上传中…' : '＋ 选择文件上传'}
          </button>
          <div className="files-hint">也可直接把文件拖到窗口。下方为桌面（~/Desktop）里的文件，微信收到的文件另存到桌面即可在此下载。</div>
          <div className="files-list">
            {files.length === 0 && <div className="muted small" style={{ padding: '10px 2px' }}>暂无文件</div>}
            {files.map((f) => (
              <a key={f.name} className="files-item" href={api.downloadFileUrl(id, f.name)} download={f.name}>
                <span className="files-name">{f.name}</span>
                <span className="files-size">{humanSize(f.size)} ↓</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
