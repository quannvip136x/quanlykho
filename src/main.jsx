import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const CLOUD_TABLES = { items: 'inventory_items', surplus: 'inventory_surplus', movements: 'inventory_movements' };

const KEYS = { items: 'inventory-react-items-v1', surplus: 'inventory-react-surplus-v1', movements: 'inventory-react-movements-v1' };
const readStore = (key, fallback = []) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fmt = n => Number(n || 0).toLocaleString('vi-VN');
function App() {
  const [page, setPage] = useState('dashboard');
  const [items, setItems] = useState(() => readStore(KEYS.items));
  const [surplus, setSurplus] = useState(() => readStore(KEYS.surplus));
  const [issueBalances, setIssueBalances] = useState({});
  const [movements, setMovements] = useState(() => readStore(KEYS.movements));
  const [movementModal, setMovementModal] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [issueHistoryCode, setIssueHistoryCode] = useState(null);
  const [issueHistoryRows, setIssueHistoryRows] = useState([]);
  const [issueHistoryLoading, setIssueHistoryLoading] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [itemModal, setItemModal] = useState(null);
  const [surplusModal, setSurplusModal] = useState(null);
  const fileRef = useRef(null);
  const surplusFileRef = useRef(null);
  async function refreshCloud() {
    if (!supabase) return;
    const [itemsResult, surplusResult, historyResult, balanceResult] = await Promise.all([
      supabase.from(CLOUD_TABLES.items).select('data').eq('id', 'shared').maybeSingle(),
      supabase.from(CLOUD_TABLES.surplus).select('data').eq('id', 'shared').maybeSingle(),
      supabase.from('inventory_history').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('inventory_issue_balance').select('code,name,balance')
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (surplusResult.error) throw surplusResult.error;
    if (historyResult.error) throw historyResult.error;
    if (balanceResult.error) throw balanceResult.error;
    if (Array.isArray(itemsResult.data?.data)) setItems(itemsResult.data.data);
    if (Array.isArray(surplusResult.data?.data)) setSurplus(surplusResult.data.data);
    setIssueBalances(Object.fromEntries((balanceResult.data || []).map(row => [String(row.code).toLowerCase(), { ...row, balance: Number(row.balance || 0) }])));
    setMovements(historyResult.data || []);
  }
  useEffect(() => {
    let alive = true;
    async function loadCloud() {
      if (!supabase) { setCloudReady(true); return; }
      try {
        await refreshCloud();
        if (!alive) return;
        setCloudReady(true);
        setNotice('Đã kết nối dữ liệu kho online.');
      } catch (err) {
        console.error(err);
        if (alive) { setCloudReady(true); setNotice(`Không tải được dữ liệu online: ${err.message || 'Kiểm tra quyền Supabase.'}`); }
      }
    }
    loadCloud();
    return () => { alive = false; };
  }, []);
  useEffect(() => { localStorage.setItem(KEYS.items, JSON.stringify(items)); }, [items]);
  useEffect(() => { localStorage.setItem(KEYS.surplus, JSON.stringify(surplus)); }, [surplus]);
  useEffect(() => { localStorage.setItem(KEYS.movements, JSON.stringify(movements)); }, [movements]);
  useEffect(() => {
    if (!supabase || !cloudReady) return;
    const timer = setInterval(async () => {
      try { await refreshCloud(); } catch (err) { console.error('Cloud refresh failed:', err); }
    }, 10000);
    return () => clearInterval(timer);
  }, [cloudReady]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 2800); return () => clearTimeout(t); }, [notice]);

  const totalStock = items.reduce((s, x) => s + Number(x.stock || 0), 0);
  const filteredItems = useMemo(() => items.filter(x => `${x.code} ${x.name} ${x.specification}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const filteredSurplus = useMemo(() => surplus.filter(x => `${x.code} ${x.name} ${x.note || ''}`.toLowerCase().includes(query.toLowerCase())), [surplus, query]);

  async function openIssueHistory(row) {
    setIssueHistoryCode(row);
    setIssueHistoryRows([]);
    setIssueHistoryLoading(true);
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('inventory_history')
          .select('*')
          .eq('code', row.code)
          .in('transaction_type', ['ISSUE_WITH_SURPLUS', 'ISSUE', 'SURPLUS_RETURN'])
          .order('created_at', { ascending: false });
        if (error) throw error;
        setIssueHistoryRows(data || []);
      } else {
        setIssueHistoryRows(movements.filter(x => String(x.code).toLowerCase() === String(row.code).toLowerCase() && ['ISSUE_WITH_SURPLUS', 'ISSUE', 'SURPLUS_RETURN'].includes(x.transaction_type)));
      }
    } catch (err) {
      console.error(err);
      setIssueHistoryRows(movements.filter(x => String(x.code).toLowerCase() === String(row.code).toLowerCase() && ['ISSUE_WITH_SURPLUS', 'ISSUE', 'SURPLUS_RETURN'].includes(x.transaction_type)));
      setNotice(`Không tải được lịch sử online: ${err.message || err}`);
    } finally {
      setIssueHistoryLoading(false);
    }
  }

  const issueSummary = useMemo(() => {
    const byCode = new Map();
    Object.values(issueBalances).forEach(row => {
      const code = String(row.code || '').trim();
      if (code) byCode.set(code.toLowerCase(), { code, name: row.name || items.find(i => i.code.toLowerCase() === code.toLowerCase())?.name || '', balance: Number(row.balance || 0) });
    });
    // Fallback cho cac phieu cu da co so du luu trong danh sach phieu hang du.
    surplus.forEach(row => {
      const code = String(row.code || '').trim();
      const key = code.toLowerCase();
      if (code && !byCode.has(key) && row.signedBalance !== undefined) {
        byCode.set(key, { code, name: row.name || '', balance: Number(row.signedBalance || 0) });
      }
    });
    return [...byCode.values()]
      .filter(row => Math.abs(row.balance) > 0)
      .map(row => ({ ...row, theyOwe: Math.max(row.balance, 0), weOwe: Math.max(-row.balance, 0) }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [issueBalances, items, surplus]);

  async function saveItem(form) {
    const code = form.code.trim();
    if (!code || !form.name.trim()) return setNotice('Vui lòng nhập mã hàng và tên hàng.');
    const duplicate = items.some(x => x.code.toLowerCase() === code.toLowerCase() && x.id !== form.id);
    if (duplicate) return setNotice('Mã hàng đã tồn tại.');
    const next = form.id
      ? items.map(x => x.id === form.id ? { ...form, code, name: form.name.trim(), stock: Number(x.stock || 0) } : x)
      : [...items, { ...form, id: makeId(), code, name: form.name.trim(), stock: Number(form.stock || 0) }];
    try {
      if (supabase) {
        const { error } = await supabase.from(CLOUD_TABLES.items).upsert({ id: 'shared', data: next });
        if (error) throw error;
      }
      setItems(next); setItemModal(null); setNotice('Đã lưu thông tin hàng hóa.');
    } catch (err) { console.error(err); setNotice(`Không lưu được hàng hóa: ${err.message}`); }
  }

  async function saveMovement(form) {
    if (!supabase) return setNotice('Chưa cấu hình kết nối Supabase.');
    const qty = Number(form.quantity);
    if (!form.code || !Number.isFinite(qty) || qty <= 0) return setNotice('Chọn mã hàng và nhập số lượng lớn hơn 0.');
    try {
      const { data, error } = await supabase.rpc('apply_inventory_transaction', {
        p_code: form.code,
        p_type: form.type,
        p_quantity: qty,
        p_note: form.note || '',
        p_reference_id: form.referenceId || null,
        p_actual_issued: null,
        p_slip_qty: null
      });
      if (error) throw error;
      await refreshCloud();
      setMovementModal(null);
      setNotice(`Đã cập nhật tồn kho: ${fmt(data?.stock_before)} → ${fmt(data?.stock_after)}.`);
    } catch (err) { console.error(err); setNotice(`Giao dịch thất bại: ${err.message || err}`); }
  }
  async function deleteItem(item) {
    if (!confirm(`Xóa hàng hóa ${item.code} - ${item.name}?`)) return;
    const next = items.filter(x => x.id !== item.id);
    try {
      if (supabase) { const { error } = await supabase.from(CLOUD_TABLES.items).upsert({ id: 'shared', data: next }); if (error) throw error; }
      setItems(next); setNotice('Đã xóa hàng hóa.');
    } catch (err) { setNotice(`Không xóa được hàng hóa: ${err.message}`); }
  }
  async function saveSurplus(form) {
    if (form.id) return setNotice('Phiếu đã ghi lịch sử không thể sửa trực tiếp. Hãy tạo giao dịch điều chỉnh nếu cần sửa tồn.');
    if (!form.code.trim() || !form.name.trim()) return setNotice('Vui lòng nhập mã liệu và tên liệu.');
    const actualIssued = Math.max(0, Number(form.actualIssued || 0));
    const slipQty = Math.max(0, Number(form.slipQty || 0));
    if (!supabase) return setNotice('Chưa cấu hình kết nối Supabase.');
    if (actualIssued === 0 && slipQty === 0) return setNotice('Nhập số lượng phát thực tế hoặc số lượng trên phiếu lớn hơn 0.');
    const difference = actualIssued - slipQty;
    let transactionApplied = false;
    try {
      const { data, error } = await supabase.rpc('apply_inventory_transaction', {
        p_code: form.code.trim(), p_type: 'ISSUE_WITH_SURPLUS', p_quantity: null,
        p_note: form.note || '', p_reference_id: form.referenceId || null,
        p_actual_issued: actualIssued, p_slip_qty: slipQty
      });
      if (error) throw error;
      transactionApplied = true;
      const signedBalance = Number(data?.signed_balance ?? 0);
      const entry = { ...form, id: makeId(), actualIssued, slipQty, difference, excess: Math.max(0, difference), shortage: Math.max(0, -difference), signedBalance, issued: actualIssued, returned: Math.max(0, difference), date: form.date || new Date().toISOString().slice(0,10) };
      const next = [entry, ...surplus];
      const { error: saveError } = await supabase.from(CLOUD_TABLES.surplus).upsert({ id: 'shared', data: next });
      if (saveError) throw saveError;
      setSurplus(next);
      await refreshCloud();
      const balanceText = signedBalance > 0 ? `Họ còn nợ mình ${fmt(signedBalance)}` : signedBalance < 0 ? `Mình còn nợ họ ${fmt(Math.abs(signedBalance))}` : 'Hai bên đã cân bằng';
      setSurplusModal(null); setNotice(`Đã ghi phiếu. ${balanceText}.`);
    } catch (err) { console.error(err); setNotice(transactionApplied ? `Tồn kho và lịch sử đã cập nhật, nhưng danh sách phiếu hàng dư chưa lưu được: ${err.message || err}. Không bấm lưu lại phiếu này.` : `Không lưu được phiếu hàng dư: ${err.message || err}`); if (transactionApplied) { setSurplusModal(null); try { await refreshCloud(); } catch {} } }
  }
  function exportExcel(type) {
    let data = type === 'items' ? items.map(({id, ...x}) => x) : type === 'surplus' ? surplus.map(({id, ...x}) => x) : movements.map(({id, ...x}) => x);
    if (!data.length) return setNotice('Chưa có dữ liệu để xuất.');
    const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type === 'items' ? 'HangHoa' : type === 'surplus' ? 'HangDu' : 'LichSu');
    XLSX.writeFile(wb, `${type === 'items' ? 'danh-sach-hang-hoa' : type === 'surplus' ? 'hang-du' : 'lich-su-kho'}.xlsx`);
  }
  function importExcel(file, type) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (!rows.length) return setNotice('File Excel không có dữ liệu.');
        const normalize = row => Object.fromEntries(Object.entries(row).map(([k,v]) => [String(k).trim().toLowerCase().replace(/[ _-]/g,''), v]));
        const normalized = rows.map(normalize);
        if (type === 'items') {
          const mapped = normalized.map(r => ({ id: makeId(), code: String(r.code ?? r.mahang ?? '').trim(), name: String(r.name ?? r.tenhang ?? '').trim(), specification: String(r.specification ?? r.quycach ?? ''), unit: String(r.unit ?? r.donvi ?? ''), stock: Number(r.stock ?? r.tonkho ?? 0) })).filter(x => x.code && x.name);
          if (!mapped.length) return setNotice('Không tìm thấy cột mã hàng/code và tên hàng/name.');
          setItems(prev => { const map = new Map(prev.map(x => [x.code.toLowerCase(), x])); mapped.forEach(x => map.set(x.code.toLowerCase(), { ...map.get(x.code.toLowerCase()), ...x, id: map.get(x.code.toLowerCase())?.id || x.id })); const next=[...map.values()]; if (supabase) supabase.from(CLOUD_TABLES.items).upsert({ id: 'shared', data: next }).then(({error})=>{ if(error) setNotice(`Lỗi đồng bộ Excel: ${error.message}`); }); return next; });
          setNotice(`Đã nhập ${mapped.length} dòng hàng hóa.`);
        } else {
          const mapped = normalized.map(r => ({ id: makeId(), date: String(r.date ?? r.ngay ?? new Date().toISOString().slice(0,10)), code: String(r.code ?? r.mahang ?? '').trim(), name: String(r.name ?? r.tenhang ?? '').trim(), issued: Number(r.issued ?? r.soluongxuat ?? 0), excess: Number(r.excess ?? r.soluongdu ?? 0), returned: Number(r.returned ?? r.soluongtrave ?? 0), note: String(r.note ?? r.ghichu ?? ''), received: false })).filter(x => x.code && x.name);
          if (!mapped.length) return setNotice('Không tìm thấy cột mã hàng/code và tên hàng/name.');
          setSurplus(prev => [...mapped, ...prev]); setNotice(`Đã nhập ${mapped.length} dòng hàng dư.`);
        }
      } catch { setNotice('Không đọc được file Excel. Hãy thử lưu file dưới dạng .xlsx.'); }
    };
    reader.readAsArrayBuffer(file);
  }
  function backup() {
    const blob = new Blob([JSON.stringify({ items, surplus, movements, exportedAt: new Date().toISOString() }, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sao-luu-kho-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); setNotice('Đã tạo file sao lưu.');
  }
  function restore(file) {
    if (!file) return; const reader = new FileReader(); reader.onload = e => { try { const d = JSON.parse(e.target.result); if (!Array.isArray(d.items) || !Array.isArray(d.surplus)) throw new Error(); if (!confirm('Khôi phục sẽ thay thế dữ liệu hiện tại. Tiếp tục?')) return; setItems(d.items); setSurplus(d.surplus); setMovements(d.movements || []); setNotice('Đã khôi phục dữ liệu.'); } catch { setNotice('File sao lưu không hợp lệ.'); } }; reader.readAsText(file);
  }

  const nav = [{id:'dashboard',label:'Tổng quan',icon:'▦'},{id:'items',label:'Danh mục hàng hóa',icon:'▤'},{id:'surplus',label:'Theo dõi hàng dư',icon:'↻'},{id:'issueSummary',label:'Thống kê phát thừa/thiếu',icon:'▥'},{id:'movements',label:'Lịch sử kho',icon:'☷'}];
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">K</div><div><strong>Kho của tôi</strong><small>QUẢN LÝ KHO HÀNG</small></div></div><div className="nav-label">MENU CHÍNH</div><nav>{nav.map(n=><button key={n.id} className={page===n.id?'nav-item active':'nav-item'} onClick={()=>{setPage(n.id);setQuery('')}}><span className="nav-icon">{n.icon}</span>{n.label}</button>)}</nav><div className="sidebar-bottom"><div className="local-note"><span className="status-dot"/> {supabase ? (cloudReady ? 'Dữ liệu online' : 'Đang kết nối...') : 'Chưa cấu hình online'}</div><button className="nav-item" onClick={backup}><span className="nav-icon">⇩</span>Sao lưu dữ liệu</button><label className="nav-item file-label"><span className="nav-icon">⇧</span>Khôi phục dữ liệu<input type="file" accept=".json,application/json" hidden onChange={e=>{restore(e.target.files[0]);e.target.value=''}}/></label></div></aside>
    <main className="main"><header className="topbar"><div><div className="eyebrow">HỆ THỐNG QUẢN LÝ</div><h1>{nav.find(n=>n.id===page)?.label}</h1></div><div className="top-right"><span className="live-pill"><i/> Đang hoạt động</span><div className="avatar">QL</div></div></header>
      {page==='dashboard' && <section className="content"><div className="welcome"><div><span className="welcome-kicker">BẢNG ĐIỀU KHIỂN</span><h2>Chào mừng trở lại! 👋</h2><p>Theo dõi hàng hóa, tồn kho và các phiếu hàng dư tại một nơi.</p></div><div className="welcome-art">▥</div></div><div className="stats-grid"><Stat title="Mặt hàng" value={fmt(items.length)} icon="▤" tone="blue" detail="Mã hàng đang quản lý"/><Stat title="Tổng tồn kho" value={fmt(totalStock)} icon="▦" tone="green" detail="Tổng số lượng hiện có"/><Stat title="Phiếu hàng dư" value={fmt(surplus.length)} icon="↻" tone="orange" detail="Tổng phiếu đã ghi nhận"/><Stat title="Chưa nhập trả" value={fmt(surplus.filter(x=>!x.received && x.returned>0).length)} icon="◷" tone="purple" detail="Phiếu cần cập nhật tồn kho"/></div><div className="dashboard-grid"><div className="panel"><div className="panel-heading"><div><h3>Hàng hóa gần đây</h3><p>Các mặt hàng mới trong danh mục</p></div><button className="text-button" onClick={()=>setPage('items')}>Xem tất cả →</button></div>{items.length ? <div className="table-wrap"><table><thead><tr><th>Mã hàng</th><th>Tên hàng</th><th>Quy cách</th><th className="right">Tồn kho</th></tr></thead><tbody>{items.slice(-5).reverse().map(x=><tr key={x.id}><td><span className="code-pill">{x.code}</span></td><td className="primary-cell">{x.name}</td><td>{x.specification || '—'}</td><td className="right"><b>{fmt(x.stock)}</b> {x.unit}</td></tr>)}</tbody></table></div> : <Empty text="Chưa có hàng hóa. Hãy thêm mặt hàng đầu tiên." action="Thêm hàng hóa" onClick={()=>setItemModal({})}/>}</div><div className="panel quick-panel"><div className="panel-heading"><div><h3>Thao tác nhanh</h3><p>Các chức năng thường dùng</p></div></div><button className="quick-action" onClick={()=>setItemModal({})}><span className="quick-icon blue">＋</span><span><b>Thêm hàng hóa</b><small>Tạo mã hàng mới</small></span><span className="arrow">→</span></button><button className="quick-action" onClick={()=>setMovementModal({type:'IN'})}><span className="quick-icon green">＋</span><span><b>Nhập kho</b><small>Cộng số lượng vào tồn kho</small></span><span className="arrow">→</span></button><button className="quick-action" onClick={()=>setMovementModal({type:'OUT'})}><span className="quick-icon orange">−</span><span><b>Xuất kho</b><small>Trừ số lượng khỏi tồn kho</small></span><span className="arrow">→</span></button><button className="quick-action" onClick={()=>setSurplusModal({})}><span className="quick-icon orange">↻</span><span><b>Tạo phiếu hàng dư</b><small>Ghi nhận hàng xuất dư</small></span><span className="arrow">→</span></button><button className="quick-action" onClick={()=>exportExcel('items')}><span className="quick-icon green">⇩</span><span><b>Xuất Excel hàng hóa</b><small>Tải danh sách hiện tại</small></span><span className="arrow">→</span></button><div className="tip-box"><b>💡 Mẹo sử dụng</b><p>Hãy sao lưu dữ liệu định kỳ để tránh mất dữ liệu khi xóa dữ liệu trình duyệt.</p></div></div></div></section>}
      {page==='items' && <section className="content"><div className="toolbar"><div className="searchbox"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm theo mã hàng, tên hàng..."/></div><div className="toolbar-actions"><button className="btn secondary" onClick={()=>fileRef.current?.click()}>⇧ Nhập Excel</button><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e=>{importExcel(e.target.files[0],'items');e.target.value=''}}/><button className="btn secondary" onClick={()=>exportExcel('items')}>⇩ Xuất Excel</button><button className="btn primary" onClick={()=>setMovementModal({type:'IN'})}>＋ Nhập kho</button><button className="btn danger" onClick={()=>setMovementModal({type:'OUT'})}>− Xuất kho</button><button className="btn secondary" onClick={()=>setItemModal({})}>＋ Thêm hàng hóa</button></div></div><div className="panel table-panel"><div className="panel-heading"><div><h3>Danh sách hàng hóa</h3><p>Đang hiển thị {filteredItems.length} / {items.length} mặt hàng</p></div></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Mã hàng</th><th>Tên hàng</th><th>Quy cách</th><th>Đơn vị</th><th className="right">Tồn kho</th><th className="right">Thao tác</th></tr></thead><tbody>{filteredItems.map((x,i)=><tr key={x.id}><td className="muted">{i+1}</td><td><span className="code-pill">{x.code}</span></td><td className="primary-cell">{x.name}</td><td>{x.specification||'—'}</td><td>{x.unit||'—'}</td><td className="right"><b>{fmt(x.stock)}</b></td><td className="right actions"><button title="Sửa" onClick={()=>setItemModal({...x})}>✎</button><button title="Xóa" onClick={()=>deleteItem(x)}>×</button></td></tr>)}</tbody></table>{!filteredItems.length&&<Empty text={items.length?'Không tìm thấy hàng hóa phù hợp.':'Chưa có dữ liệu hàng hóa.'} action="Thêm hàng hóa" onClick={()=>setItemModal({})}/>}</div></div><p className="footnote">Định dạng Excel nhập: <b>code, name, specification, unit, stock</b> hoặc các cột tiếng Việt tương đương (mahang, tenhang, quycach, donvi, tonkho).</p></section>}
      {page==='surplus' && <section className="content"><div className="toolbar"><div className="searchbox"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm theo mã hàng, tên hàng..."/></div><div className="toolbar-actions"><button className="btn secondary" onClick={()=>surplusFileRef.current?.click()}>⇧ Nhập Excel</button><input ref={surplusFileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e=>{importExcel(e.target.files[0],'surplus');e.target.value=''}}/><button className="btn secondary" onClick={()=>exportExcel('surplus')}>⇩ Xuất Excel</button><button className="btn primary" onClick={()=>setSurplusModal({})}>＋ Tạo phiếu hàng dư</button></div></div><div className="panel table-panel"><div className="panel-heading"><div><h3>Danh sách phiếu hàng dư</h3><p>Số dư bù trừ theo mã hàng: dương = họ nợ mình, âm = mình nợ họ</p></div></div><div className="table-wrap"><table><thead><tr><th>Ngày</th><th>Mã hàng</th><th>Tên hàng</th><th className="right">SL phát thực tế</th><th className="right">SL trên phiếu</th><th className="right">Phát sinh (+/−)</th><th className="right">Số dư hiện tại</th><th className="right">Thao tác</th></tr></thead><tbody>{filteredSurplus.map(x=>{const balance=Number(issueBalances[String(x.code||'').toLowerCase()]?.balance ?? x.signedBalance ?? 0);return <tr key={x.id}><td>{x.date||'—'}</td><td><span className="code-pill">{x.code}</span></td><td className="primary-cell">{x.name}</td><td className="right">{fmt(x.actualIssued ?? x.issued)}</td><td className="right">{fmt(x.slipQty ?? 0)}</td><td className="right"><b>{Number(x.difference ?? (Number(x.actualIssued ?? x.issued ?? 0)-Number(x.slipQty||0)))>0?'+':''}{fmt(x.difference ?? (Number(x.actualIssued ?? x.issued ?? 0)-Number(x.slipQty||0)))}</b></td><td className="right"><b className={balance>0?'balance-positive':balance<0?'balance-negative':''}>{balance>0?'+':''}{fmt(balance)}</b><small className="field-help">{balance>0?'Họ nợ mình':balance<0?'Mình nợ họ':'Cân bằng'}</small></td><td className="right actions"><button title="Không sửa phiếu đã ghi lịch sử" disabled>🔒</button></td></tr>})}</tbody></table>{!filteredSurplus.length&&<Empty text="Chưa có phiếu hàng dư." action="Tạo phiếu hàng dư" onClick={()=>setSurplusModal({})}/>}</div></div><p className="footnote">Cách tính: số dư mới = số dư cũ + (phát thực tế − số lượng trên phiếu). Số dương: họ nợ mình; số âm: mình nợ họ.</p></section>}
      {page==='issueSummary' && <section className="content">
        <div className="toolbar">
          <div><h3 className="section-title">Thống kê nguyên vật liệu phát thừa / thiếu</h3><p className="sub-title">Số dư được cộng dồn theo từng mã hàng. Nhấn vào mã hàng để xem lịch sử phát.</p></div>
          <div className="searchbox"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm theo mã hàng, tên hàng..."/></div>
        </div>
        <div className="stats-grid issue-summary-stats">
          <Stat title="Mã hàng còn số dư" value={fmt(issueSummary.length)} icon="▤" tone="blue" detail="Các mã chưa cân bằng"/>
          <Stat title="Họ còn nợ mình" value={fmt(issueSummary.reduce((s,x)=>s+x.theyOwe,0))} icon="＋" tone="green" detail="Tổng số lượng dương"/>
          <Stat title="Mình còn nợ họ" value={fmt(issueSummary.reduce((s,x)=>s+x.weOwe,0))} icon="−" tone="orange" detail="Tổng số lượng âm"/>
        </div>
        <div className="panel table-panel">
          <div className="panel-heading"><div><h3>Bảng tổng hợp theo mã nguyên vật liệu</h3><p>Dương: họ nợ mình · Âm: mình nợ họ · 0: đã cân bằng</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Mã nguyên vật liệu</th><th>Tên nguyên vật liệu</th><th className="right">Họ nợ mình</th><th className="right">Mình nợ họ</th><th className="right">Số dư (+/−)</th><th>Trạng thái</th></tr></thead><tbody>
            {issueSummary.filter(x=>`${x.code} ${x.name}`.toLowerCase().includes(query.toLowerCase())).map((x,i)=><tr key={x.code}>
              <td className="muted">{i+1}</td>
              <td><button className="code-link" onClick={()=>openIssueHistory(x)} title="Xem lịch sử phát hàng">{x.code} ↗</button></td>
              <td className="primary-cell">{x.name || '—'}</td>
              <td className="right balance-positive">{x.theyOwe ? fmt(x.theyOwe) : '—'}</td>
              <td className="right balance-negative">{x.weOwe ? fmt(x.weOwe) : '—'}</td>
              <td className={`right balance-value ${x.balance>0?'balance-positive':'balance-negative'}`}><b>{x.balance>0?'+':''}{fmt(x.balance)}</b></td>
              <td><span className={`badge ${x.balance>0?'success':'pending'}`}>{x.balance>0?'Họ nợ mình':'Mình nợ họ'}</span></td>
            </tr>)}
          </tbody></table>
          {!issueSummary.length && <Empty text="Chưa có nguyên vật liệu nào phát sinh số dư thừa hoặc thiếu."/>}
          {issueSummary.length>0 && !issueSummary.some(x=>`${x.code} ${x.name}`.toLowerCase().includes(query.toLowerCase())) && <Empty text="Không tìm thấy mã hàng phù hợp."/>}
          </div>
        </div>
        <p className="footnote">Nhấn vào mã nguyên vật liệu để xem từng phiếu phát, số lượng thực tế, số lượng trên phiếu và số dư sau mỗi lần phát.</p>
      </section>}
      {page==='movements' && <section className="content"><div className="toolbar"><div><h3 className="section-title">Lịch sử biến động kho</h3><p className="sub-title">Lịch sử nhập, xuất, phát liệu, trả dư và điều chỉnh tồn kho</p></div><div className="toolbar-actions"><button className="btn secondary" onClick={()=>exportExcel('movements')}>⇩ Xuất Excel</button><button className="btn primary" onClick={()=>setMovementModal({type:'IN'})}>＋ Nhập kho</button><button className="btn danger" onClick={()=>setMovementModal({type:'OUT'})}>− Xuất kho</button></div></div><div className="toolbar"><div className="searchbox"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm theo mã, tên hoặc ghi chú..."/></div></div><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Thời gian</th><th>Mã hàng</th><th>Tên hàng</th><th>Loại giao dịch</th><th className="right">SL thay đổi</th><th className="right">Tồn trước</th><th className="right">Tồn sau</th><th>Ghi chú</th></tr></thead><tbody>{movements.filter(x=>`${x.code} ${x.name} ${x.note||''} ${x.transaction_type||''}`.toLowerCase().includes(query.toLowerCase())).map(x=><tr key={x.id}><td>{new Date(x.created_at || x.date).toLocaleString('vi-VN')}</td><td><span className="code-pill">{x.code}</span></td><td className="primary-cell">{x.name}</td><td><span className={`badge ${Number(x.delta)>=0?'success':'pending'}`}>{({IN:'Nhập kho',OUT:'Xuất kho',ISSUE:'Phát liệu',SURPLUS_RETURN:'Trả hàng dư',ADJUST_IN:'Điều chỉnh tăng',ADJUST_OUT:'Điều chỉnh giảm'})[x.transaction_type] || x.transaction_type}</span></td><td className="right"><b>{Number(x.delta)>0?'+':''}{fmt(x.delta)}</b></td><td className="right">{fmt(x.stock_before)}</td><td className="right"><b>{fmt(x.stock_after)}</b></td><td>{x.note||'—'}</td></tr>)}</tbody></table>{!movements.length&&<Empty text="Chưa có giao dịch kho nào."/>}</div></div></section>}
      <footer className="footer">Quản lý kho hàng <span>•</span> {supabase ? 'Dữ liệu đồng bộ online khoảng mỗi 10 giây' : 'Chưa cấu hình kết nối cơ sở dữ liệu online'}</footer>
    </main>
    {itemModal && <ItemDialog initial={itemModal} onClose={()=>setItemModal(null)} onSave={saveItem}/>}
    {surplusModal && <SurplusDialog initial={surplusModal} items={items} issueBalances={issueBalances} onClose={()=>setSurplusModal(null)} onSave={saveSurplus}/>}
    {movementModal && <MovementDialog items={items} onClose={()=>setMovementModal(null)} onSave={saveMovement}/>} 
    {issueHistoryCode && <IssueHistoryDialog row={issueHistoryCode} rows={issueHistoryRows} loading={issueHistoryLoading} onClose={()=>setIssueHistoryCode(null)}/>}
    {notice&&<div className="toast">✓ {notice}</div>}
  </div>;
}
function Stat({title,value,icon,tone,detail}) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-title">{title}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div>; }
function Empty({text,action,onClick}) { return <div className="empty"><div className="empty-icon">▤</div><p>{text}</p>{action&&<button className="btn primary" onClick={onClick}>{action}</button>}</div>; }
function IssueHistoryDialog({row,rows,loading,onClose}) {
  const balanceText = value => value > 0 ? 'Họ nợ mình' : value < 0 ? 'Mình nợ họ' : 'Cân bằng';
  return <Modal title={`Lịch sử phát hàng · ${row.code}`} onClose={onClose}>
    <div className="issue-history-summary"><b>{row.name || row.code}</b><span className={row.balance>0?'balance-positive':'balance-negative'}>Số dư hiện tại: <strong>{row.balance>0?'+':''}{fmt(row.balance)}</strong> · {balanceText(row.balance)}</span></div>
    {loading ? <div className="empty">Đang tải lịch sử phát hàng...</div> : <div className="table-wrap issue-history-table"><table><thead><tr><th>Thời gian</th><th className="right">Phát thực tế</th><th className="right">Trên phiếu</th><th className="right">Phát sinh</th><th className="right">Số dư sau phiếu</th><th>Ghi chú</th></tr></thead><tbody>
      {rows.map(x=>{const d=x.details||{};const actual=Number(d.actual_issued ?? x.quantity ?? 0);const slip=Number(d.slip_qty ?? x.quantity ?? 0);const diff=Number(d.difference ?? (actual-slip));const balance=Number(d.signed_balance ?? d.balance_after ?? 0);return <tr key={x.id}><td>{new Date(x.created_at||x.date).toLocaleString('vi-VN')}</td><td className="right">{fmt(actual)}</td><td className="right">{d.slip_qty===undefined?'—':fmt(slip)}</td><td className={`right ${diff>0?'balance-positive':diff<0?'balance-negative':''}`}>{diff>0?'+':''}{fmt(diff)}</td><td className={`right ${balance>0?'balance-positive':balance<0?'balance-negative':''}`}>{d.signed_balance===undefined?'—':`${balance>0?'+':''}${fmt(balance)}`}</td><td>{x.note||'—'}</td></tr>})}
    </tbody></table>{!rows.length&&<Empty text="Chưa tìm thấy lịch sử phát cho mã hàng này."/>}</div>}
    <div className="modal-actions issue-history-actions"><button className="btn secondary" onClick={onClose}>Đóng</button></div>
  </Modal>;
}

function ItemDialog({initial,onClose,onSave}) { const [form,setForm]=useState({code:'',name:'',specification:'',unit:'',stock:0,...initial}); const set=(k,v)=>setForm(p=>({...p,[k]:v})); return <Modal title={initial.id?'Cập nhật hàng hóa':'Thêm hàng hóa mới'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSave(form)}}><div className="form-grid"><Field label="Mã hàng *"><input required value={form.code} onChange={e=>set('code',e.target.value)} placeholder="VD: HH001"/></Field><Field label="Tên hàng *"><input required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Nhập tên hàng"/></Field><Field label="Quy cách"><input value={form.specification||''} onChange={e=>set('specification',e.target.value)} placeholder="VD: 10 x 20 cm"/></Field><Field label="Đơn vị tính"><input value={form.unit||''} onChange={e=>set('unit',e.target.value)} placeholder="VD: cái, hộp, kg"/></Field><Field label={initial.id?"Tồn kho hiện tại (điều chỉnh ở Giao dịch kho)":"Tồn kho ban đầu"} wide><input type="number" min="0" step="any" value={form.stock??0} disabled={!!initial.id} onChange={e=>set('stock',e.target.value)}/></Field></div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Hủy</button><button className="btn primary" type="submit">Lưu hàng hóa</button></div></form></Modal>; }
function SurplusDialog({initial,items,issueBalances,onClose,onSave}) {
  const [form,setForm]=useState({date:new Date().toISOString().slice(0,10),code:'',name:'',actualIssued:0,slipQty:0,note:'',...initial});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  function pickCode(code) { const item=items.find(x=>x.code.toLowerCase()===String(code).toLowerCase()); setForm(p=>({...p,code,name:item?.name||p.name})); }
  const difference=Number(form.actualIssued||0)-Number(form.slipQty||0);
  const previousBalance=Number(issueBalances[String(form.code||'').toLowerCase()]?.balance||0);
  const nextBalance=previousBalance+difference;
  const balanceLabel=value=>value>0?`Họ còn nợ mình ${fmt(value)}`:value<0?`Mình còn nợ họ ${fmt(Math.abs(value))}`:'Hai bên đã cân bằng';
  return <Modal title="Tạo phiếu hàng dư / bù trừ" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSave(form)}}><div className="form-grid">
    <Field label="Mã liệu *"><input required list="item-codes" value={form.code} onChange={e=>pickCode(e.target.value)} placeholder="Nhập hoặc chọn mã liệu"/><datalist id="item-codes">{items.map(x=><option key={x.id} value={x.code}>{x.name}</option>)}</datalist></Field>
    <Field label="Tên liệu *" wide><input required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Tên liệu"/></Field>
    <Field label="Số lượng phát thực tế"><input type="number" min="0" step="any" value={form.actualIssued??0} onChange={e=>set('actualIssued',e.target.value)}/></Field>
    <Field label="Số lượng trên phiếu"><input type="number" min="0" step="any" value={form.slipQty??0} onChange={e=>set('slipQty',e.target.value)}/></Field>
    <Field label="Phát sinh phiếu (+ / −)" wide><input type="text" value={`${difference>0?'+':''}${fmt(difference)}`} readOnly/><small className="field-help">Phát thực tế − số lượng trên phiếu. Dương: họ nợ mình; âm: mình nợ họ.</small></Field>
    <Field label="Số dư trước phiếu"><input type="text" value={`${previousBalance>0?'+':''}${fmt(previousBalance)} — ${balanceLabel(previousBalance)}`} readOnly/></Field>
    <Field label="Số dư sau phiếu"><input type="text" value={`${nextBalance>0?'+':''}${fmt(nextBalance)} — ${balanceLabel(nextBalance)}`} readOnly/></Field>
    <Field label="Ghi chú" wide><textarea rows="2" value={form.note||''} onChange={e=>set('note',e.target.value)} placeholder="Ghi chú / số phiếu"/></Field>
  </div><div className="hint">Tồn kho chỉ trừ theo số lượng phát thực tế. Số dư bù trừ được cộng dồn theo từng mã hàng và có thể âm hoặc dương.</div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Hủy</button><button className="btn primary" type="submit">Lưu phiếu</button></div></form></Modal>;
}
function MovementDialog({items,onClose,onSave}) {
  const [form,setForm]=useState({code:items[0]?.code||'',type:'IN',quantity:'',note:'',referenceId:''});
  const [itemSearch,setItemSearch]=useState('');
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const searchText=itemSearch.trim().toLocaleLowerCase('vi');
  const filteredItems=items.filter(x=>`${x.code||''} ${x.name||''} ${x.specification||''}`.toLocaleLowerCase('vi').includes(searchText));
  const selectedItem=items.find(x=>x.code===form.code);
  const visibleItems=selectedItem && !filteredItems.some(x=>x.code===selectedItem.code) ? [selectedItem,...filteredItems] : filteredItems;
  return <Modal title="Tạo giao dịch kho" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSave(form)}}><div className="form-grid">
    <Field label="Tìm nhanh mã hàng / tên hàng" wide><div className="transaction-search"><span>⌕</span><input value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder="Nhập mã hàng hoặc tên hàng để lọc danh sách..." autoFocus /></div></Field>
    <Field label="Mã hàng *" wide><select value={form.code} onChange={e=>set('code',e.target.value)} required><option value="">Chọn mã hàng ({filteredItems.length} kết quả)</option>{visibleItems.map(x=><option key={x.id} value={x.code}>{x.code} — {x.name} (tồn: {fmt(x.stock)})</option>)}</select>{filteredItems.length===0&&<small className="field-help">Không tìm thấy mã hàng phù hợp.</small>}</Field>
    <Field label="Loại giao dịch *" wide><select value={form.type} onChange={e=>set('type',e.target.value)}><option value="IN">Nhập kho (+)</option><option value="OUT">Xuất kho (−)</option><option value="ADJUST_IN">Điều chỉnh tăng (+)</option><option value="ADJUST_OUT">Điều chỉnh giảm (−)</option></select></Field>
    <Field label="Số lượng *"><input required type="number" min="0.000001" step="any" value={form.quantity} onChange={e=>set('quantity',e.target.value)}/></Field>
    <Field label="Mã tham chiếu"><input value={form.referenceId} onChange={e=>set('referenceId',e.target.value)} placeholder="Số phiếu (nếu có)"/></Field>
    <Field label="Ghi chú" wide><textarea rows="3" value={form.note} onChange={e=>set('note',e.target.value)} placeholder="Ghi chú giao dịch"/></Field>
  </div><div className="hint">Tồn kho sẽ được cập nhật trên Supabase và lịch sử được ghi tự động trong cùng một giao dịch.</div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Hủy</button><button className="btn primary" type="submit">Xác nhận giao dịch</button></div></form></Modal>;
}
function Field({label,children,wide}) { return <label className={`field ${wide?'wide':''}`}><span>{label}</span>{children}</label>; }
function Modal({title,children,onClose}) { return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="close" onClick={onClose}>×</button></div>{children}</div></div>; }

createRoot(document.getElementById('root')).render(<App/>);
