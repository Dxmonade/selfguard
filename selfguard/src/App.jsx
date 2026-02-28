// ─────────────────────────────────────────────────────────────
//  SelfGuard — App.jsx  (วางแทนไฟล์ src/App.jsx ทั้งหมด)
//  npm install @supabase/supabase-js recharts
// ─────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ══════════════════════════════════════════════════════════════
// 1.  SUPABASE  — ใส่ค่าของคุณตรงนี้
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ══════════════════════════════════════════════════════════════
// 2.  CONSTANTS & HELPERS
// ══════════════════════════════════════════════════════════════
const DAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

const GLOBAL_CSS = `
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; overscroll-behavior: none; }
  input, button { font-size: 16px !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #0a0c10; }
  ::-webkit-scrollbar-thumb { background: #1e2a38; border-radius: 2px; }
`;

function useIsMobile() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return w < 640;
}

function avg(h) { return h.reduce((a, b) => a + b, 0) / h.length; }
function daysLeft(stock, h) { const a = avg(h); return a === 0 ? 999 : Math.floor(stock / a); }
function getStatus(p) {
  const d = daysLeft(p.stock, p.history);
  if (p.stock <= p.min_threshold || d <= 3) return "danger";
  if (d <= 7) return "warning";
  return "safe";
}

const STATUS = {
  danger:  { bg: "#ff3b3b22", border: "#ff3b3b", text: "#ff3b3b", label: "ใกล้หมด!" },
  warning: { bg: "#ffb30022", border: "#ffb300", text: "#ffb300", label: "เหลือน้อย" },
  safe:    { bg: "#00e57022", border: "#00e570", text: "#00e570", label: "ปกติ" },
};

const card = { background: "#0f1318", border: "1px solid #1e2a38", borderRadius: 12 };
const btnStyle = (color) => ({
  background: `${color}22`, border: `1px solid ${color}`, borderRadius: 8,
  padding: "9px 18px", color, cursor: "pointer", fontSize: 13, fontFamily: "inherit",
});

// Line Notify — ส่งผ่าน Supabase Edge Function (ดูคำอธิบายด้านล่าง)
async function sendLineNotify(token, message) {
  if (!token) return;
  try {
    await supabase.functions.invoke("line-notify", { body: { token, message } });
  } catch (e) {
    console.error("Line Notify error:", e);
  }
}

// ══════════════════════════════════════════════════════════════
// 3.  MAIN APP
// ══════════════════════════════════════════════════════════════
export default function SelfGuard() {
  const isMobile = useIsMobile();

  // inject CSS + viewport
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = GLOBAL_CSS;
    document.head.appendChild(s);
    let m = document.querySelector("meta[name=viewport]");
    if (!m) { m = document.createElement("meta"); m.name = "viewport"; document.head.appendChild(m); }
    m.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    return () => document.head.removeChild(s);
  }, []);

  // ── state ──────────────────────────────────────────────────
  const [products, setProducts]   = useState([]);
  const [settings, setSettings]   = useState(null);   // loaded from supabase
  const [loading, setLoading]     = useState(true);
  const [mode, setMode]           = useState("admin");
  const [adminTab, setAdminTab]   = useState("dashboard");
  const [selected, setSelected]   = useState(null);
  const [adjustQty, setAdjustQty] = useState(1);
  const [search, setSearch]       = useState("");
  const [catFilter, setCatFilter] = useState("ทั้งหมด");
  const [notiLog, setNotiLog]     = useState([]);
  const [notiOpen, setNotiOpen]   = useState(false);
  const [cart, setCart]           = useState({});
  const [orderDone, setOrderDone] = useState(false);
  const [orderList, setOrderList] = useState([]);

  // ── fetch products + settings ──────────────────────────────
  useEffect(() => {
    async function fetchAll() {
      const [{ data: prods }, { data: cfg }] = await Promise.all([
        supabase.from("products").select("*").order("id"),
        supabase.from("settings").select("*").eq("id", 1).single(),
      ]);
      if (prods) setProducts(prods);
      if (cfg)   setSettings(cfg);
      setLoading(false);

      // daily noti on load
      if (prods && cfg?.daily_on && cfg?.line_token) {
        const dangers = prods.filter(p => getStatus(p) === "danger");
        if (dangers.length > 0) {
          const msg = `📋 [SelfGuard Daily] สินค้าใกล้หมด:\n` +
            dangers.map(p => `• ${p.name} เหลือ ${p.stock} ${p.unit} (~${daysLeft(p.stock, p.history)} วัน)`).join("\n");
          sendLineNotify(cfg.line_token, msg);
          setNotiLog(dangers.map(p => ({
            type: "daily",
            text: `📋 [Daily] ${p.name} เหลือ ${p.stock} ${p.unit} — ~${daysLeft(p.stock, p.history)} วัน`,
            time: `${cfg.daily_time} (auto)`,
          })));
        }
      }
    }
    fetchAll();
  }, []);

  // ── adjust stock ───────────────────────────────────────────
  async function adjustStock(id, delta) {
    const product = products.find(p => p.id === id);
    const newStock = Math.max(0, product.stock + delta);
    await supabase.from("products").update({ stock: newStock }).eq("id", id);

    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, stock: newStock };
      const wasSafe = getStatus(p) !== "danger";
      const nowDanger = getStatus(updated) === "danger";
      if (wasSafe && nowDanger) {
        const msg = `⚠️ [SelfGuard] ${p.name} เหลือ ${newStock} ${p.unit} ต่ำกว่า threshold (${p.min_threshold})`;
        if (settings?.realtime_on && settings?.line_token) sendLineNotify(settings.line_token, msg);
        setNotiLog(n => [{
          type: "realtime",
          text: msg,
          time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
        }, ...n]);
      }
      return updated;
    }));
  }

  // ── cart ───────────────────────────────────────────────────
  function addCart(id) {
    setCart(c => {
      const product = products.find(p => p.id === id);
      const current = c[id] || 0;
      if (current >= product.stock) return c;
      return { ...c, [id]: current + 1 };
    });
  }
  function removeCart(id) {
    setCart(c => { const n = { ...c }; if (n[id] > 1) n[id]--; else delete n[id]; return n; });
  }
  function placeOrder() {
    const items = Object.entries(cart).map(([id, qty]) => ({
      ...products.find(p => p.id === parseInt(id)), qty,
    }));
    setOrderList(items);
    items.forEach(i => adjustStock(i.id, -i.qty));
    setCart({}); setOrderDone(true);
  }

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find(p => p.id === parseInt(id));
    return sum + (p?.price || 0) * qty;
  }, 0);

  const filtered = useMemo(() =>
    products.filter(p => {
      const ms = p.name.includes(search) || p.category.includes(search);
      const mc = catFilter === "ทั้งหมด" || p.category === catFilter;
      return ms && mc;
    }), [products, search, catFilter]);

  const alerts = products.filter(p => getStatus(p) !== "safe");
  const totalGraph = DAYS.map((day, i) => ({ day, total: products.reduce((s, p) => s + p.history[i], 0) }));

  // ── loading screen ─────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0c10", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 40 }}>⚡</div>
      <div style={{ color: "#00e570", fontFamily: "monospace", letterSpacing: 3, fontSize: 14 }}>LOADING...</div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: "#0a0c10", color: "#e8eaf0", fontFamily: "'DM Mono','Courier New',monospace" }}>

      {/* ── Top Bar ── */}
      <div style={{ background: "#0f1318", borderBottom: "1px solid #1e2a38", padding: isMobile ? "12px 16px" : "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg,#00e570,#00b4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: "bold", color: "#0a0c10" }}>S</div>
          <div>
            <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: "bold", letterSpacing: 2, color: "#fff" }}>SELFGUARD</div>
            {!isMobile && <div style={{ fontSize: 10, color: "#4a6070", letterSpacing: 1 }}>STOCK INTELLIGENCE</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", background: "#141a22", border: "1px solid #1e2a38", borderRadius: 8, overflow: "hidden" }}>
            {[["admin", isMobile ? "🔧" : "🔧 Admin"], ["customer", isMobile ? "🛒" : "🛒 ลูกค้า"]].map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} style={{ background: mode === m ? "#00e57022" : "none", border: "none", borderRight: m === "admin" ? "1px solid #1e2a38" : "none", color: mode === m ? "#00e570" : "#4a6070", padding: isMobile ? "8px 12px" : "7px 14px", cursor: "pointer", fontSize: isMobile ? 16 : 12, fontFamily: "inherit", minWidth: isMobile ? 44 : "auto", minHeight: 44 }}>{label}</button>
            ))}
          </div>
          {mode === "admin" && (
            <button onClick={() => setNotiOpen(o => !o)} style={{ position: "relative", background: notiLog.length ? "#ff3b3b22" : "#141a22", border: `1px solid ${notiLog.length ? "#ff3b3b55" : "#1e2a38"}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 16, color: notiLog.length ? "#ff3b3b" : "#4a6070", minWidth: 44, minHeight: 44 }}>
              🔔
              {notiLog.length > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: "#ff3b3b", borderRadius: "50%", width: 16, height: 16, fontSize: 10, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{notiLog.length}</span>}
            </button>
          )}
          {mode === "customer" && cartCount > 0 && (
            <div style={{ background: "#00e57022", border: "1px solid #00e57055", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#00e570" }}>🛒 {cartCount} · ฿{cartTotal}</div>
          )}
        </div>
      </div>

      {/* ── Noti Panel ── */}
      {notiOpen && mode === "admin" && (
        <div style={{ position: "fixed", top: 70, right: isMobile ? 8 : 24, width: isMobile ? "calc(100vw - 16px)" : 340, zIndex: 300, background: "#141a22", border: "1px solid #1e2a38", borderRadius: 12, boxShadow: "0 8px 32px #000a", maxHeight: "60vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1e2a38", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#fff" }}>📲 Line Notify Log</div>
            <button onClick={() => { setNotiLog([]); setNotiOpen(false); }} style={{ background: "none", border: "none", color: "#4a6070", cursor: "pointer", fontSize: 12 }}>ล้าง ✕</button>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {notiLog.length === 0
              ? <div style={{ padding: 20, textAlign: "center", color: "#4a6070", fontSize: 13 }}>ไม่มีการแจ้งเตือน</div>
              : notiLog.map((n, i) => (
                <div key={i} style={{ padding: "12px 16px", borderBottom: "1px solid #1e2a3844", borderLeft: `3px solid ${n.type === "realtime" ? "#ff3b3b" : "#00b4ff"}` }}>
                  <div style={{ fontSize: 12, color: "#e8eaf0", lineHeight: 1.6 }}>{n.text}</div>
                  <div style={{ fontSize: 10, color: "#4a6070", marginTop: 4 }}>{n.type === "realtime" ? "⚡ Real-time" : "📅 Daily"} · {n.time}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ══ ADMIN ══════════════════════════════════════════════ */}
      {mode === "admin" && (
        <div>
          {/* Tabs */}
          <div style={{ display: "flex", padding: isMobile ? "0 8px" : "0 24px", borderBottom: "1px solid #1e2a38", background: "#0f1318", overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
            {[["dashboard", "📦 Stock"], ["graph", "📊 Usage"], ["predict", "🔮 Predict"], ["settings", "⚙️ Settings"]].map(([id, label]) => (
              <button key={id} onClick={() => setAdminTab(id)} style={{ background: "none", border: "none", borderBottom: adminTab === id ? "2px solid #00e570" : "2px solid transparent", color: adminTab === id ? "#00e570" : "#4a6070", padding: isMobile ? "12px 14px" : "14px 18px", cursor: "pointer", fontSize: isMobile ? 11 : 12, letterSpacing: 1, fontFamily: "inherit", whiteSpace: "nowrap", minHeight: 44 }}>{label}</button>
            ))}
          </div>

          <div style={{ padding: isMobile ? 16 : 24, margin: "0 auto" }}>

            {/* ── DASHBOARD ── */}
            {adminTab === "dashboard" && (
              <div>
                <input placeholder="🔍  ค้นหาสินค้า..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", background: "#141a22", border: "1px solid #1e2a38", borderRadius: 10, padding: "12px 16px", color: "#e8eaf0", fontSize: 14, fontFamily: "inherit", marginBottom: 20, outline: "none" }} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: isMobile ? 8 : 16, marginBottom: 20 }}>
                  {[
                    { label: "สินค้าทั้งหมด", value: products.length, color: "#00b4ff" },
                    { label: "ต้องเติมด่วน", value: alerts.filter(p => getStatus(p) === "danger").length, color: "#ff3b3b" },
                    { label: "เหลือน้อย", value: alerts.filter(p => getStatus(p) === "warning").length, color: "#ffb300" },
                  ].map(c => (
                    <div key={c.label} style={{ ...card, border: `1px solid ${c.color}33`, padding: isMobile ? "12px 8px" : 16, textAlign: "center" }}>
                      <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: "bold", color: c.color }}>{c.value}</div>
                      <div style={{ fontSize: isMobile ? 9 : 11, color: "#4a6070", marginTop: 4 }}>{c.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {filtered.map(product => {
                    const st = getStatus(product); const s = STATUS[st];
                    const dl = daysLeft(product.stock, product.history);
                    const isOpen = selected === product.id;
                    return (
                      <div key={product.id} style={{ ...card, border: `1px solid ${isOpen ? s.border : "#1e2a38"}`, background: isOpen ? "#141a22" : "#0f1318" }}>
                        <div onClick={() => setSelected(isOpen ? null : product.id)} style={{ padding: isMobile ? "14px 12px" : "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, minHeight: 60 }}>
                          {!isMobile && <div style={{ fontSize: 22 }}>{product.img}</div>}
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.border, boxShadow: `0 0 8px ${s.border}`, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: "bold", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.name}</div>
                            <div style={{ fontSize: 11, color: "#4a6070" }}>{product.category}</div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: "bold", color: s.text }}>{product.stock}<span style={{ fontSize: 10, color: "#4a6070", marginLeft: 3 }}>{product.unit}</span></div>
                            <div style={{ fontSize: 10, color: "#4a6070" }}>{dl < 999 ? `~${dl} วัน` : "—"}</div>
                          </div>
                          {!isMobile && <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, color: s.text }}>{s.label}</div>}
                          <div style={{ color: "#4a6070", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</div>
                        </div>
                        {isOpen && (
                          <div style={{ borderTop: "1px solid #1e2a38", padding: isMobile ? "14px 12px" : "14px 20px", background: "#0a0e14", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, color: "#4a6070" }}>ปรับ Stock:</span>
                            <input type="number" min="1" value={adjustQty} onChange={e => setAdjustQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: 60, background: "#141a22", border: "1px solid #1e2a38", borderRadius: 6, color: "#fff", padding: "8px", fontSize: 16, fontFamily: "inherit", textAlign: "center" }} />
                            <button onClick={() => adjustStock(product.id, adjustQty)} style={{ ...btnStyle("#00e570"), flex: 1, minHeight: 44, padding: "8px 12px" }}>+ เติม</button>
                            <button onClick={() => adjustStock(product.id, -adjustQty)} style={{ ...btnStyle("#ff3b3b"), flex: 1, minHeight: 44, padding: "8px 12px" }}>− ใช้</button>
                            <span style={{ width: "100%", fontSize: 11, color: "#4a6070" }}>threshold: {product.min_threshold} {product.unit}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── GRAPH ── */}
            {adminTab === "graph" && (
              <div>
                <div style={{ fontSize: 12, color: "#4a6070", marginBottom: 8, letterSpacing: 1 }}>TOTAL USAGE / 7 วัน</div>
                <div style={{ ...card, padding: "20px 8px", marginBottom: 24 }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={totalGraph} barSize={28}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2a38" vertical={false} />
                      <XAxis dataKey="day" stroke="#4a6070" tick={{ fontSize: 12, fill: "#4a6070" }} axisLine={false} tickLine={false} />
                      <YAxis stroke="#4a6070" tick={{ fontSize: 12, fill: "#4a6070" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#141a22", border: "1px solid #1e2a38", borderRadius: 8, color: "#e8eaf0", fontSize: 12 }} cursor={{ fill: "#ffffff08" }} />
                      <Bar dataKey="total" fill="#00b4ff" radius={[4, 4, 0, 0]} name="ยอดรวม" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {products.map(p => {
                    const chartData = p.history.map((v, i) => ({ day: DAYS[i], usage: v }));
                    return (
                      <div key={p.id} style={{ ...card, padding: "16px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: "bold", color: "#fff" }}>{p.img} {p.name}</div>
                          <div style={{ fontSize: 12, color: "#4a6070" }}>เฉลี่ย {avg(p.history).toFixed(1)} {p.unit}/วัน</div>
                        </div>
                        <ResponsiveContainer width="100%" height={70}>
                          <LineChart data={chartData}>
                            <Line type="monotone" dataKey="usage" stroke="#00e570" strokeWidth={2} dot={{ fill: "#00e570", r: 3 }} />
                            <XAxis dataKey="day" hide /><YAxis hide />
                            <Tooltip contentStyle={{ background: "#141a22", border: "1px solid #1e2a38", borderRadius: 6, fontSize: 11, color: "#e8eaf0" }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── PREDICT ── */}
            {adminTab === "predict" && (
              <div>
                <div style={{ fontSize: 12, color: "#4a6070", marginBottom: 14, letterSpacing: 1 }}>AI PREDICTION — avg 7 วัน</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[...products]
                    .map(p => ({ ...p, dl: daysLeft(p.stock, p.history), st: getStatus(p) }))
                    .sort((a, b) => a.dl - b.dl)
                    .map(p => {
                      const s = STATUS[p.st];
                      const emptyDate = new Date(); emptyDate.setDate(emptyDate.getDate() + p.dl);
                      const dateStr = p.dl < 999 ? emptyDate.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) : "—";
                      const barW = Math.min(100, (p.dl / 30) * 100);
                      return (
                        <div key={p.id} style={{ ...card, border: `1px solid ${p.st !== "safe" ? s.border + "66" : "#1e2a38"}`, padding: "18px 20px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: "bold", color: "#fff" }}>{p.img} {p.name}</div>
                              <div style={{ fontSize: 12, color: "#4a6070", marginTop: 2 }}>เหลือ {p.stock} {p.unit} · เฉลี่ย {avg(p.history).toFixed(1)}/วัน</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 20, fontWeight: "bold", color: s.text }}>{p.dl < 999 ? p.dl : "∞"}<span style={{ fontSize: 12, color: "#4a6070", marginLeft: 4 }}>วัน</span></div>
                              <div style={{ fontSize: 11, color: "#4a6070" }}>หมด ~{dateStr}</div>
                            </div>
                          </div>
                          <div style={{ height: 6, background: "#1e2a38", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${barW}%`, borderRadius: 3, background: p.st === "danger" ? "linear-gradient(90deg,#ff3b3b,#ff6b6b)" : p.st === "warning" ? "linear-gradient(90deg,#ffb300,#ffd04a)" : "linear-gradient(90deg,#00e570,#00b4ff)" }} />
                          </div>
                          {p.st !== "safe" && (
                            <div style={{ marginTop: 10, fontSize: 12, color: s.text, background: s.bg, border: `1px solid ${s.border}33`, borderRadius: 6, padding: "6px 10px", display: "inline-block" }}>
                              {p.st === "danger" ? `⚠️ ควรสั่งซื้อภายใน ${Math.max(0, p.dl - 1)} วัน` : `📋 วางแผนสั่งซื้อภายใน ${p.dl - 3} วัน`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ── SETTINGS ── */}
            {adminTab === "settings" && (
              <SettingsTab
                isMobile={isMobile} card={card} btnStyle={btnStyle}
                settings={settings} setSettings={setSettings}
                setNotiLog={setNotiLog} setNotiOpen={setNotiOpen}
                sendLineNotify={sendLineNotify}
              />
            )}
          </div>
        </div>
      )}

      {/* ══ CUSTOMER ═══════════════════════════════════════════ */}
      {mode === "customer" && (
        <div style={{ margin: "0 auto", padding: isMobile ? 16 : 24 }}>
          {orderDone ? (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 22, fontWeight: "bold", color: "#00e570", marginBottom: 8 }}>สั่งซื้อสำเร็จ!</div>
              <div style={{ fontSize: 14, color: "#4a6070", marginBottom: 32 }}>ทางร้านได้รับออเดอร์แล้ว</div>
              <div style={{ ...card, padding: 20, textAlign: "left", marginBottom: 24 }}>
                {orderList.map(item => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1e2a3866", fontSize: 14 }}>
                    <span>{item.img} {item.name} <span style={{ color: "#4a6070" }}>× {item.qty}</span></span>
                    <span style={{ color: "#00e570", fontWeight: "bold" }}>฿{item.price * item.qty}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 14, fontWeight: "bold", fontSize: 16 }}>
                  <span>รวม</span><span style={{ color: "#00e570" }}>฿{orderList.reduce((s, i) => s + i.price * i.qty, 0)}</span>
                </div>
              </div>
              <button onClick={() => setOrderDone(false)} style={{ ...card, padding: "12px 28px", color: "#e8eaf0", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>← กลับ</button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: "bold", color: "#fff", marginBottom: 4 }}>🏪 สินค้าในร้าน</div>
              <div style={{ fontSize: 12, color: "#4a6070", marginBottom: 16 }}>เลือกสินค้าและกดสั่งซื้อ</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                {["ทั้งหมด", "เครื่องดื่ม", "อาหาร", "ของใช้"].map(cat => (
                  <button key={cat} onClick={() => setCatFilter(cat)} style={{ background: catFilter === cat ? "#00e57022" : "#141a22", border: `1px solid ${catFilter === cat ? "#00e570" : "#1e2a38"}`, borderRadius: 20, padding: "6px 14px", color: catFilter === cat ? "#00e570" : "#4a6070", cursor: "pointer", fontSize: 12, fontFamily: "inherit", minHeight: 36 }}>{cat}</button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: isMobile ? 10 : 16, marginBottom: 120 }}>
                {filtered.map(product => {
                  const qty = cart[product.id] || 0;
                  const outOfStock = product.stock === 0;
                  const st = getStatus(product);
                  return (
                    <div key={product.id} style={{ ...card, opacity: outOfStock ? 0.5 : 1, border: qty > 0 ? "1px solid #00e57066" : "1px solid #1e2a38" }}>
                      <div style={{ fontSize: 48, textAlign: "center", padding: "20px 0 10px", background: "#141a22", borderRadius: "12px 12px 0 0" }}>{product.img}</div>
                      <div style={{ padding: "14px 16px" }}>
                        <div style={{ fontSize: 14, fontWeight: "bold", color: "#fff", marginBottom: 2 }}>{product.name}</div>
                        <div style={{ fontSize: 11, color: "#4a6070", marginBottom: 8 }}>{product.category}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ fontSize: 18, fontWeight: "bold", color: "#00e570" }}>฿{product.price}</div>
                          {st === "danger" && !outOfStock && <div style={{ fontSize: 10, color: "#ff3b3b", background: "#ff3b3b22", border: "1px solid #ff3b3b44", borderRadius: 4, padding: "2px 6px" }}>เหลือน้อย</div>}
                          {outOfStock && <div style={{ fontSize: 10, color: "#4a6070", background: "#1e2a38", borderRadius: 4, padding: "2px 6px" }}>หมด</div>}
                        </div>
                        {outOfStock
                          ? <div style={{ textAlign: "center", fontSize: 12, color: "#4a6070", padding: "10px 0" }}>สินค้าหมด</div>
                          : qty === 0
                          ? <button onClick={() => addCart(product.id)} style={{ width: "100%", background: "#00e57022", border: "1px solid #00e570", borderRadius: 8, padding: "11px 0", color: "#00e570", cursor: "pointer", fontSize: 13, fontFamily: "inherit", minHeight: 44 }}>+ ใส่ตะกร้า</button>
                          : <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0a0c10", borderRadius: 8, border: "1px solid #00e57066", minHeight: 44 }}>
                              <button onClick={() => removeCart(product.id)} style={{ background: "none", border: "none", color: "#ff3b3b", padding: "8px 16px", cursor: "pointer", fontSize: 20, fontFamily: "inherit", minWidth: 44, minHeight: 44 }}>−</button>
                              <div style={{ textAlign: "center" }}>
                                <span style={{ fontSize: 16, fontWeight: "bold", color: "#00e570" }}>{qty}</span>
                                {qty >= product.stock && <div style={{ fontSize: 9, color: "#ffb300" }}>สูงสุดแล้ว</div>}
                              </div>
                              <button onClick={() => addCart(product.id)} disabled={qty >= product.stock} style={{ background: "none", border: "none", color: qty >= product.stock ? "#2a3a48" : "#00e570", padding: "8px 16px", cursor: qty >= product.stock ? "not-allowed" : "pointer", fontSize: 20, fontFamily: "inherit", minWidth: 44, minHeight: 44 }}>+</button>
                            </div>
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
              {cartCount > 0 && (
                <div style={{ position: "fixed", bottom: isMobile ? 16 : 24, left: "50%", transform: "translateX(-50%)", width: `calc(100% - ${isMobile ? 32 : 48}px)`, maxWidth: 652, background: "#0f1318", border: "1px solid #00e57066", borderRadius: 14, padding: isMobile ? "14px 16px" : "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 8px 40px #000e", zIndex: 100 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#4a6070" }}>{cartCount} รายการ</div>
                    <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: "bold", color: "#00e570" }}>฿{cartTotal}</div>
                  </div>
                  <button onClick={placeOrder} style={{ background: "linear-gradient(135deg,#00e570,#00b4ff)", border: "none", borderRadius: 10, padding: isMobile ? "12px 20px" : "12px 28px", color: "#0a0c10", fontSize: isMobile ? 13 : 14, fontWeight: "bold", cursor: "pointer", fontFamily: "inherit", minHeight: 44 }}>สั่งซื้อเลย →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 4.  SETTINGS TAB
// ══════════════════════════════════════════════════════════════
function SettingsTab({ isMobile, card, btnStyle, settings, setSettings, setNotiLog, setNotiOpen, sendLineNotify }) {
  const [lineToken, setLineToken]   = useState(settings?.line_token || "");
  const [dailyTime, setDailyTime]   = useState(settings?.daily_time || "08:00");
  const [realtimeOn, setRealtimeOn] = useState(settings?.realtime_on ?? true);
  const [dailyOn, setDailyOn]       = useState(settings?.daily_on ?? true);
  const [showToken, setShowToken]   = useState(false);
  const [saved, setSaved]           = useState(false);
  const [saving, setSaving]         = useState(false);

  async function saveAll() {
    setSaving(true);
    const updates = { line_token: lineToken, realtime_on: realtimeOn, daily_on: dailyOn, daily_time: dailyTime };
    await supabase.from("settings").update(updates).eq("id", 1);
    setSettings(prev => ({ ...prev, ...updates }));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function sendTest() {
    if (!lineToken) { alert("กรุณาใส่ Line Token ก่อนครับ"); return; }
    await sendLineNotify(lineToken, "🧪 [SelfGuard Test] ทดสอบส่งข้อความสำเร็จ!");
    setNotiLog(n => [{ type: "realtime", text: "🧪 [Test] ข้อความทดสอบจาก SelfGuard", time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) }, ...n]);
    setNotiOpen(true);
  }

  const inputStyle = { width: "100%", background: "#0a0c10", border: "1px solid #1e2a38", borderRadius: 8, padding: "10px 14px", color: "#e8eaf0", fontSize: 14, fontFamily: "inherit", outline: "none" };

  const Toggle = ({ on, onChange, color }) => (
    <div onClick={() => onChange(!on)} style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer", flexShrink: 0, background: on ? `${color}aa` : "#1e2a38", border: `1px solid ${on ? color : "#1e2a38"}`, position: "relative", transition: "all 0.2s" }}>
      <div style={{ position: "absolute", top: 3, left: on ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: on ? color : "#4a6070", transition: "left 0.2s" }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
      <div style={{ fontSize: 12, color: "#4a6070", letterSpacing: 1 }}>⚙️ SETTINGS</div>

      {/* Line Notify Token */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: "bold", color: "#fff" }}>📲 Line Notify Token</div>
          <a href="https://notify-bot.line.me/th/" target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 11, color: "#00b4ff", textDecoration: "none" }}>ขอ Token →</a>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type={showToken ? "text" : "password"} placeholder="วาง Token ที่ได้จาก notify-bot.line.me..." value={lineToken} onChange={e => setLineToken(e.target.value)} style={inputStyle} />
          <button onClick={() => setShowToken(s => !s)} style={{ background: "#141a22", border: "1px solid #1e2a38", borderRadius: 8, padding: "10px 12px", color: "#4a6070", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>{showToken ? "🙈" : "👁"}</button>
        </div>
        {lineToken && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e570" }} /><div style={{ fontSize: 11, color: "#00e570" }}>Token พร้อมใช้งาน</div></div>}
        <div style={{ fontSize: 11, color: "#4a6070", marginTop: 8 }}>Token ถูกเก็บใน Supabase — ใช้งานได้ทุกเครื่อง</div>
      </div>

      {/* Notification toggles */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: "bold", color: "#fff", marginBottom: 14 }}>🔔 การแจ้งเตือน</div>
        {[
          { icon: "⚡", label: "Real-time Alert", desc: "แจ้งทันทีเมื่อ stock ต่ำกว่า threshold", color: "#ff3b3b", on: realtimeOn, set: setRealtimeOn },
          { icon: "📅", label: "Daily Summary", desc: "สรุปสินค้าใกล้หมดรายวัน", color: "#00b4ff", on: dailyOn, set: setDailyOn },
        ].map(n => (
          <div key={n.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid #1e2a3855" }}>
            <div style={{ fontSize: 20 }}>{n.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#fff" }}>{n.label}</div>
              <div style={{ fontSize: 11, color: "#4a6070" }}>{n.desc}</div>
            </div>
            <Toggle on={n.on} onChange={n.set} color={n.color} />
          </div>
        ))}
        {dailyOn && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 14 }}>
            <div style={{ fontSize: 20 }}>⏰</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: "#fff" }}>เวลาส่งสรุปรายวัน</div></div>
            <input type="time" value={dailyTime} onChange={e => setDailyTime(e.target.value)} style={{ background: "#0a0c10", border: "1px solid #1e2a38", borderRadius: 8, padding: "8px 12px", color: "#e8eaf0", fontSize: 14, fontFamily: "inherit", outline: "none", colorScheme: "dark" }} />
          </div>
        )}
      </div>

      {/* Preview */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ fontSize: 13, color: "#ffb300", marginBottom: 12, fontWeight: "bold" }}>📱 ตัวอย่างข้อความ</div>
        {[
          { label: "⚡ Real-time", msg: "⚠️ [SelfGuard] มาม่า รสหมู เหลือ 8 ซอง ต่ำกว่า threshold (30)" },
          { label: `📅 Daily ${dailyTime}`, msg: "📋 [SelfGuard Daily] สินค้าใกล้หมด:\n• มาม่า รสหมู เหลือ 8 ซอง (~0 วัน)\n• ขนมปังแผ่น เหลือ 5 แพ็ค (~1 วัน)" },
        ].map(m => (
          <div key={m.label} style={{ background: "#0a0c10", border: "1px solid #1e2a38", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#4a6070", marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 12, color: "#e8eaf0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{m.msg}</div>
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 10, flexDirection: isMobile ? "column" : "row" }}>
        <button onClick={sendTest} style={{ ...btnStyle("#ffb300"), flex: 1, padding: "13px", minHeight: 44 }}>🧪 ทดสอบส่ง Noti</button>
        <button onClick={saveAll} disabled={saving} style={{ flex: 2, background: saved ? "#00e57022" : "linear-gradient(135deg,#00e570,#00b4ff)", border: saved ? "1px solid #00e570" : "none", borderRadius: 10, padding: "13px", minHeight: 44, color: saved ? "#00e570" : "#0a0c10", fontSize: 14, fontWeight: "bold", cursor: "pointer", fontFamily: "inherit" }}>
          {saving ? "⏳ กำลังบันทึก..." : saved ? "✅ บันทึกแล้ว!" : "💾 บันทึกการตั้งค่า"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 5.  SUPABASE EDGE FUNCTION (แยกไฟล์)
// ══════════════════════════════════════════════════════════════
//
//  สร้างไฟล์ supabase/functions/line-notify/index.ts
//  แล้ว deploy ด้วย: npx supabase functions deploy line-notify
//
//  ─── supabase/functions/line-notify/index.ts ───────────────
//
//  import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
//
//  serve(async (req) => {
//    const { token, message } = await req.json()
//    const res = await fetch("https://notify-api.line.me/api/notify", {
//      method: "POST",
//      headers: {
//        "Authorization": `Bearer ${token}`,
//        "Content-Type": "application/x-www-form-urlencoded",
//      },
//      body: new URLSearchParams({ message }),
//    })
//    return new Response(JSON.stringify({ ok: res.ok }), {
//      headers: { "Content-Type": "application/json" },
//    })
//  })
//
// ─────────────────────────────────────────────────────────────