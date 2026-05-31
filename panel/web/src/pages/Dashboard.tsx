import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useUI, PasswordInput } from '../ui';
import { api, type InstanceWithStatus } from '../api';

const BUSY_PHASES = ['downloading', 'extracting', 'installing'];

export default function Dashboard() {
  const { user, logout, refresh } = useAuth();
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [instances, setInstances] = useState<InstanceWithStatus[] | null>(null);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const timer = useRef<number | undefined>(undefined);
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    try {
      const { instances } = await api.listInstances();
      setInstances(instances);
    } catch (e: any) {
      setErr(e.message || '加载失败');
    }
  };

  useEffect(() => {
    load();
    return () => window.clearTimeout(timer.current);
  }, []);

  // 任一实例安装/更新进行中时轮询
  useEffect(() => {
    window.clearTimeout(timer.current);
    const busy = instances?.some((i) => BUSY_PHASES.includes(i.wechat.phase));
    if (busy) timer.current = window.setTimeout(load, 1500);
    return () => window.clearTimeout(timer.current);
  }, [instances]);

  const trigger = async (inst: InstanceWithStatus, kind: 'install' | 'update') => {
    setErr('');
    try {
      await (kind === 'install' ? api.instanceWechatInstall(inst.id) : api.instanceWechatUpdate(inst.id));
      setInstances(
        (list) =>
          list?.map((i) =>
            i.id === inst.id ? { ...i, wechat: { ...i.wechat, phase: 'downloading', percent: -1, message: '正在准备…' } } : i,
          ) ?? list,
      );
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(load, 1000);
      toast(kind === 'install' ? '已开始下载微信' : '已开始更新', 'ok');
    } catch (e: any) {
      setErr(e.message || '操作失败');
      toast(e.message || '操作失败', 'error');
    }
  };

  const start = async (inst: InstanceWithStatus) => {
    setErr('');
    setStarting((s) => new Set(s).add(inst.id));
    try {
      await api.instanceStart(inst.id);
      toast('实例已启动', 'ok');
      await load();
    } catch (e: any) {
      toast(e.message || '启动失败', 'error');
    } finally {
      setStarting((s) => {
        const n = new Set(s);
        n.delete(inst.id);
        return n;
      });
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <span className="topbar-title">云微</span>
        <button
          className="btn-text"
          onClick={async () => {
            if (await confirm({ title: '退出登录？', confirmText: '退出' })) logout();
          }}
        >
          退出
        </button>
      </header>

      <main className="content">
        <div className="hello">
          你好，<b>{user?.username}</b>
          {isAdmin && <span className="tag">管理员</span>}
        </div>

        {user?.mustChangePassword && (
          <button className="warn-banner" onClick={() => setShowPw(true)}>
            <span className="warn-icon">!</span>
            <span className="warn-text">
              <b>你还在使用默认密码</b>
              <span>该系统登录着你的微信，请立即修改密码 ›</span>
            </span>
          </button>
        )}

        {err && <div className="error">{err}</div>}

        <div className="section-row">
          <span className="section-title">微信实例</span>
          {isAdmin && (
            <button className="btn-text" onClick={() => nav('/admin')}>
              管理 ›
            </button>
          )}
        </div>

        {instances && instances.length === 0 && (
          <div className="empty-state">
            <div className="empty-blob"><img src="/favicon.svg" alt="" /></div>
            <div className="empty-title">还没有微信实例</div>
            <div className="empty-sub">{isAdmin ? '去「管理」新建一个微信实例' : '请联系管理员为你分配实例'}</div>
          </div>
        )}

        <div className="inst-grid">
          {instances?.map((inst) => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              isAdmin={isAdmin}
              starting={starting.has(inst.id)}
              onEnter={() => nav(`/desktop/${inst.id}`)}
              onTrigger={trigger}
              onStart={() => start(inst)}
            />
          ))}
        </div>

        <div className="list">
          <button className="list-item" onClick={() => setShowPw(true)}>
            <span>修改密码</span>
            <span className="enter-arrow">›</span>
          </button>
          {isAdmin && (
            <button className="list-item" onClick={() => nav('/admin')}>
              <span>实例与子账号管理</span>
              <span className="enter-arrow">›</span>
            </button>
          )}
        </div>
      </main>

      {showPw && <ChangePassword onClose={() => setShowPw(false)} onSaved={() => refresh()} />}
    </div>
  );
}

function InstanceCard({
  inst,
  isAdmin,
  starting,
  onEnter,
  onTrigger,
  onStart,
}: {
  inst: InstanceWithStatus;
  isAdmin?: boolean;
  starting?: boolean;
  onEnter: () => void;
  onTrigger: (inst: InstanceWithStatus, kind: 'install' | 'update') => void;
  onStart: () => void;
}) {
  const wx = inst.wechat;
  const busy = BUSY_PHASES.includes(wx.phase);
  const installed = wx.installed && wx.phase !== 'downloading';
  const offline = inst.runtime !== 'running';

  let badge: { text: string; cls: string };
  if (offline) badge = { text: inst.runtime === 'missing' ? '未创建' : '已停止', cls: 'tag-off' };
  else if (busy) badge = { text: '处理中', cls: 'tag-busy' };
  else if (installed) badge = { text: '在线', cls: 'tag-on' };
  else badge = { text: '待安装', cls: 'tag-warn' };

  let sub: string;
  if (offline) sub = inst.runtime === 'missing' ? '容器尚未创建' : '容器已停止，需先启动';
  else if (busy) sub = wx.percent >= 0 ? `${wx.message || '处理中'} ${wx.percent}%` : wx.message || '请稍候…';
  else if (wx.phase === 'error') sub = wx.message || '操作失败，可重试';
  else if (installed) sub = wx.version ? `微信 ${wx.version}` : '微信已安装';
  else sub = '微信尚未安装';

  const canEnter = !offline && installed && !busy;

  return (
    <div className="inst-card">
      <div className="inst-head">
        <span className="inst-name">{inst.name}</span>
        <span className={'tag ' + badge.cls}>{badge.text}</span>
      </div>
      <div className="inst-sub">{sub}</div>

      {busy && (
        <div className="wx-progress">
          <div
            className={'wx-progress-bar' + (wx.percent < 0 ? ' indeterminate' : '')}
            style={wx.percent >= 0 ? { width: `${wx.percent}%` } : undefined}
          />
        </div>
      )}

      <div className="inst-actions">
        {offline && isAdmin ? (
          <button className="btn btn-primary inst-enter" disabled={starting} onClick={onStart}>
            {starting ? '启动中…' : inst.runtime === 'missing' ? '创建并启动' : '启动实例'}
          </button>
        ) : (
          <button className="btn btn-primary inst-enter" disabled={!canEnter} onClick={onEnter}>
            进入微信
          </button>
        )}
        {isAdmin && !busy && !offline && (
          installed ? (
            <button className="btn inst-act" onClick={() => onTrigger(inst, 'update')}>
              更新
            </button>
          ) : (
            <button className="btn inst-act" onClick={() => onTrigger(inst, 'install')}>
              下载安装
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ChangePassword({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setMsg('修改成功');
      onSaved?.(); // 刷新当前用户，清除「默认密码」提示
      setTimeout(onClose, 800);
    } catch (e: any) {
      setMsg(e.message || '修改失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>修改密码</h2>
        <PasswordInput placeholder="原密码" autoComplete="current-password" value={oldPassword} onChange={setOld} />
        <PasswordInput placeholder="新密码（至少 6 位）" autoComplete="new-password" value={newPassword} onChange={setNew} />
        {msg && <div className={msg === '修改成功' ? 'ok' : 'error'}>{msg}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy || !oldPassword || !newPassword}>
            确定
          </button>
        </div>
      </form>
    </div>
  );
}
