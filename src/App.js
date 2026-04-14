import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

// ── 常數 ───────────────────────────────────────────────────
const AVATARS = ['🐻','🦊','🐧','🐱','🐶','🐸','🐼','🦁','🐯','🐨'];
const COLORS  = ['#b06ad0','#d06a6a','#6a9ed0','#6ad08a','#d0a86a','#d06aa8','#6ad0c8','#a8d06a'];

// ── Helpers ────────────────────────────────────────────────
function getUser(users, id) { return users.find(u => u.id === id); }

export default function App() {
  const [screen, setScreen]   = useState('loading'); // loading | setup | main
  const [me, setMe]           = useState(null);
  const [users, setUsers]     = useState([]);
  const [wallet, setWallet]   = useState({});  // { coinOwnerId: amount }
  const [history, setHistory] = useState([]);
  const [shops, setShops]     = useState({});  // { ownerId: [items] }
  const [tab, setTab]         = useState('home');
  const [shopOwner, setShopOwner] = useState(null);
  const [toast, setToast]     = useState(null);
  const [loading, setLoading] = useState(false);

  // setup form
  const [setupName, setSetupName]     = useState('');
  const [setupCoin, setSetupCoin]     = useState('');
  const [setupAvatar, setSetupAvatar] = useState(AVATARS[0]);
  const [setupColor, setSetupColor]   = useState(COLORS[0]);

  // send modal
  const [sendModal, setSendModal]   = useState(null);
  const [sendAmt, setSendAmt]       = useState(1);
  const [sendReason, setSendReason] = useState('');

  // redeem modal
  const [redeemModal, setRedeemModal] = useState(null);

  // my shop
  const [newItem, setNewItem] = useState({ name: '', desc: '', cost: 1 });

  // ── 初始化：從 localStorage 讀取已存的 userId ──────────────
  useEffect(() => {
    const savedId = localStorage.getItem('starboard_user_id');
    if (savedId) {
      loadUser(savedId);
    } else {
      setScreen('setup');
    }
  }, []);

  async function loadUser(userId) {
    setScreen('loading');
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (error || !data) {
      localStorage.removeItem('starboard_user_id');
      setScreen('setup');
      return;
    }
    setMe(data);
    localStorage.setItem('starboard_user_id', data.id);
    await loadAll(data);
    setScreen('main');
  }

  const loadAll = useCallback(async (meData) => {
    const m = meData || me;
    if (!m) return;

    // 所有使用者
    const { data: allUsers } = await supabase.from('users').select('*');
    setUsers(allUsers || []);

    // 我的錢包
    const { data: walletRows } = await supabase
      .from('wallets').select('*').eq('owner_id', m.id);
    const w = {};
    (walletRows || []).forEach(r => { w[r.coin_owner_id] = r.amount; });
    setWallet(w);

    // 紀錄
    const { data: logs } = await supabase
      .from('star_logs').select('*').order('created_at', { ascending: false }).limit(20);
    setHistory(logs || []);

    // 所有人的商店
    const { data: items } = await supabase.from('shop_items').select('*');
    const s = {};
    (items || []).forEach(item => {
      if (!s[item.owner_id]) s[item.owner_id] = [];
      s[item.owner_id].push(item);
    });
    setShops(s);
  }, [me]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── 註冊 ──────────────────────────────────────────────────
  async function handleSetup() {
    if (!setupName.trim() || !setupCoin.trim()) return;
    setLoading(true);
    const { data, error } = await supabase.from('users').insert({
      name: setupName.trim(),
      coin_name: setupCoin.trim(),
      avatar: setupAvatar,
      color: setupColor,
    }).select().single();
    if (error) { showToast('建立失敗 😢'); setLoading(false); return; }
    setMe(data);
    localStorage.setItem('starboard_user_id', data.id);
    await loadAll(data);
    setScreen('main');
    setLoading(false);
  }

  // ── 送星星 ────────────────────────────────────────────────
  async function sendStars() {
    if (!sendReason.trim() || sendAmt < 1) return;
    setLoading(true);
    // 接收方的錢包增加「我的幣」
    const { data: existing } = await supabase
      .from('wallets').select('*')
      .eq('owner_id', sendModal).eq('coin_owner_id', me.id).single();

    if (existing) {
      await supabase.from('wallets').update({ amount: existing.amount + sendAmt })
        .eq('id', existing.id);
    } else {
      await supabase.from('wallets').insert({
        owner_id: sendModal, coin_owner_id: me.id, amount: sendAmt
      });
    }
    await supabase.from('star_logs').insert({
      from_id: me.id, to_id: sendModal, amount: sendAmt, reason: sendReason
    });
    setSendModal(null); setSendReason(''); setSendAmt(1);
    showToast(`送出 ${sendAmt} 顆 ${me.coin_name} ⭐`);
    await loadAll();
    setLoading(false);
  }

  // ── 兌換 ──────────────────────────────────────────────────
  async function redeemItem() {
    const { item, ownerId } = redeemModal;
    const myCoins = wallet[ownerId] || 0;
    if (myCoins < item.cost) { showToast('星星不夠 😢'); return; }
    setLoading(true);

    const { data: existing } = await supabase
      .from('wallets').select('*')
      .eq('owner_id', me.id).eq('coin_owner_id', ownerId).single();

    await supabase.from('wallets').update({ amount: myCoins - item.cost })
      .eq('id', existing.id);

    await supabase.from('redemptions').insert({
      item_id: item.id, buyer_id: me.id
    });

    setRedeemModal(null); setShopOwner(null);
    showToast('兌換成功！🎉');
    await loadAll();
    setLoading(false);
  }

  // ── 上架商品 ───────────────────────────────────────────────
  async function addShopItem() {
    if (!newItem.name.trim()) return;
    setLoading(true);
    await supabase.from('shop_items').insert({
      owner_id: me.id, name: newItem.name.trim(),
      description: newItem.desc, cost: newItem.cost, available: true
    });
    setNewItem({ name: '', desc: '', cost: 1 });
    showToast('商品已上架 🏪');
    await loadAll();
    setLoading(false);
  }

  async function toggleItem(item) {
    await supabase.from('shop_items').update({ available: !item.available }).eq('id', item.id);
    await loadAll();
  }

  const friends = users.filter(u => u.id !== me?.id);
  const myItems = shops[me?.id] || [];

  // ── 畫面：loading ─────────────────────────────────────────
  if (screen === 'loading') return (
    <div style={{ ...s.root, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div style={{ fontSize: 48, animation: 'spin 2s linear infinite' }}>✦</div>
      <div style={{ color: '#8870b0', fontSize: 14 }}>載入中...</div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );

  // ── 畫面：setup ───────────────────────────────────────────
  if (screen === 'setup') return (
    <div style={s.root}>
      <div style={s.noise} />
      <div style={{ padding: '60px 24px 40px', position:'relative', zIndex:1 }}>
        <div style={{ fontSize: 32, textAlign:'center', marginBottom: 8 }}>✦</div>
        <div style={{ ...s.logo, textAlign:'center', fontSize: 24, marginBottom: 6 }}>starboard</div>
        <div style={{ textAlign:'center', color:'#6655a0', fontSize: 13, marginBottom: 40 }}>設定你的帳號</div>

        <div style={s.addCard}>
          <div style={s.field}>
            <label style={s.label}>你的名字</label>
            <input style={s.input} placeholder="例如：小雨" value={setupName}
              onChange={e => setSetupName(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>你的幣名稱</label>
            <input style={s.input} placeholder="例如：雨幣、熊幣..." value={setupCoin}
              onChange={e => setSetupCoin(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>選一個頭像</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap: 8 }}>
              {AVATARS.map(a => (
                <button key={a} onClick={() => setSetupAvatar(a)}
                  style={{ fontSize:28, background: setupAvatar===a ? 'rgba(200,184,240,0.2)':'rgba(255,255,255,0.04)',
                    border: setupAvatar===a ? '2px solid #b06ad0':'2px solid transparent',
                    borderRadius:12, padding:'6px 10px', cursor:'pointer' }}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>幣的顏色</label>
            <div style={{ display:'flex', gap: 8 }}>
              {COLORS.map(c => (
                <button key={c} onClick={() => setSetupColor(c)}
                  style={{ width:28, height:28, borderRadius:'50%', background:c, border: setupColor===c?'3px solid #fff':'3px solid transparent', cursor:'pointer' }} />
              ))}
            </div>
          </div>
          <button style={{ ...s.primaryBtn, opacity: loading ? 0.6:1 }} onClick={handleSetup} disabled={loading}>
            {loading ? '建立中...' : '開始使用 ✦'}
          </button>
        </div>

        <div style={{ textAlign:'center', color:'#444', fontSize:12, marginTop:20 }}>
          已有帳號？請在同一個裝置上開啟，或請朋友把連結傳給你
        </div>
      </div>
    </div>
  );

  // ── 畫面：main ────────────────────────────────────────────
  return (
    <div style={s.root}>
      <div style={s.noise} />
      {toast && <div style={s.toast}>{toast}</div>}
      {loading && <div style={s.loadingBar} />}

      <header style={s.header}>
        <span style={s.logo}>✦ starboard</span>
        <div style={s.avatarChip}>
          <span style={{ fontSize:18 }}>{me.avatar}</span>
          <span style={{ fontSize:13, color:'#c8b8f0', fontWeight:600 }}>{me.name}</span>
        </div>
      </header>

      <main style={s.main}>
        {tab==='home'   && <HomeTab   me={me} friends={friends} wallet={wallet} history={history} users={users}
                                      onSend={uid=>{setSendModal(uid);setSendAmt(1);setSendReason('');}}
                                      onShop={uid=>{setShopOwner(uid);setTab('shop');}} />}
        {tab==='shop'   && <ShopTab   me={me} friends={friends} shops={shops} wallet={wallet}
                                      shopOwner={shopOwner} setShopOwner={setShopOwner} users={users}
                                      onRedeem={(item,ownerId)=>setRedeemModal({item,ownerId})}
                                      onBack={()=>{setShopOwner(null);setTab('home');}} />}
        {tab==='myshop' && <MyShopTab me={me} myItems={myItems} newItem={newItem}
                                      setNewItem={setNewItem} onAdd={addShopItem} onToggle={toggleItem} />}
      </main>

      <nav style={s.nav}>
        {[['home','⭐','首頁'],['shop','🏪','商店'],['myshop','✏️','我的店']].map(([key,icon,label])=>(
          <button key={key} style={{...s.navBtn,...(tab===key?s.navActive:{})}}
            onClick={()=>{setTab(key);if(key!=='shop')setShopOwner(null);}}>
            <span style={{fontSize:22}}>{icon}</span>
            <span style={{fontSize:10}}>{label}</span>
          </button>
        ))}
      </nav>

      {/* Send Modal */}
      {sendModal && (()=>{
        const target = getUser(users, sendModal);
        if (!target) return null;
        return (
          <Modal onClose={()=>setSendModal(null)}>
            <div style={s.modalTitle}>送星星給 {target.avatar} {target.name}</div>
            <div style={s.modalNote}>對方會收到你的 <CoinBadge user={me} />，可以在你的商店使用</div>
            <div style={s.field}>
              <label style={s.label}>數量（無上限）</label>
              <div style={s.amtRow}>
                <button style={s.amtBtn} onClick={()=>setSendAmt(a=>Math.max(1,a-1))}>－</button>
                <span style={s.amtNum}>{sendAmt}</span>
                <button style={s.amtBtn} onClick={()=>setSendAmt(a=>a+1)}>＋</button>
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>原因</label>
              <textarea style={s.textarea} placeholder="為什麼送這些星星呢？"
                value={sendReason} onChange={e=>setSendReason(e.target.value)} />
            </div>
            <button style={{...s.primaryBtn,opacity:loading?0.6:1}} onClick={sendStars} disabled={loading}>
              {loading?'送出中...':'確認送出'}
            </button>
          </Modal>
        );
      })()}

      {/* Redeem Modal */}
      {redeemModal && (()=>{
        const owner = getUser(users, redeemModal.ownerId);
        const have  = wallet[redeemModal.ownerId] || 0;
        const enough = have >= redeemModal.item.cost;
        return (
          <Modal onClose={()=>setRedeemModal(null)}>
            <div style={s.modalTitle}>確認兌換</div>
            <div style={s.redeemCard}>
              <div style={s.redeemName}>{redeemModal.item.name}</div>
              <div style={s.redeemDesc}>{redeemModal.item.description}</div>
              <div style={s.redeemCost}><CoinBadge user={owner} /> × {redeemModal.item.cost}</div>
            </div>
            <div style={{fontSize:13,color:enough?'#80c080':'#d07070',textAlign:'center',marginBottom:20}}>
              你有 {have} 顆 {owner?.coin_name}，兌換後剩 {have - redeemModal.item.cost} 顆
            </div>
            <button style={{...s.primaryBtn,opacity:enough&&!loading?1:0.4}}
              onClick={enough&&!loading?redeemItem:undefined}>
              {loading?'兌換中...':'確認兌換'}
            </button>
          </Modal>
        );
      })()}
    </div>
  );
}

// ── Home Tab ──────────────────────────────────────────────
function HomeTab({ me, friends, wallet, history, users, onSend, onShop }) {
  return (
    <div>
      <div style={s.walletCard}>
        <div style={s.walletTop}>
          <span style={{fontSize:36}}>{me.avatar}</span>
          <div>
            <div style={s.walletName}>{me.name} 的錢包</div>
            <div style={s.walletSub}>收到朋友的幣，可以去他們的店消費</div>
          </div>
        </div>
        <div style={s.coinList}>
          {Object.entries(wallet).filter(([,amt])=>amt>0).length===0
            ? <div style={s.empty}>還沒收到任何星星</div>
            : Object.entries(wallet).map(([ownerId, amt])=>{
                const owner = users.find(u=>u.id===ownerId);
                if (!owner || amt<=0) return null;
                return (
                  <div key={ownerId} style={s.coinRow}>
                    <span style={{fontSize:22}}>{owner.avatar}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:'#f0eaff'}}>{owner.coin_name}</div>
                      <div style={{fontSize:11,color:'#8870b0'}}>在 {owner.name} 的店使用</div>
                    </div>
                    <div style={{color:owner.color,fontWeight:700,fontSize:16,marginRight:8}}>★ {amt}</div>
                    <button style={s.goShopBtn} onClick={()=>onShop(ownerId)}>去消費</button>
                  </div>
                );
              })
          }
        </div>
      </div>

      <section style={s.section}>
        <div style={s.sectionTitle}>朋友</div>
        {friends.length===0 && <div style={s.empty}>還沒有朋友，把連結分享給他們吧！</div>}
        {friends.map(f=>(
          <div key={f.id} style={s.friendRow}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:30}}>{f.avatar}</span>
              <div>
                <div style={s.friendName}>{f.name}</div>
                <CoinBadge user={f} small />
              </div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={s.outlineBtn} onClick={()=>onShop(f.id)}>去他的店</button>
              <button style={{...s.starBtn,background:`linear-gradient(135deg,${f.color}99,${f.color})`}}
                onClick={()=>onSend(f.id)}>送 ⭐</button>
            </div>
          </div>
        ))}
      </section>

      <section style={s.section}>
        <div style={s.sectionTitle}>最近紀錄</div>
        {history.length===0 && <div style={s.empty}>還沒有任何紀錄</div>}
        {history.map(h=>{
          const from=users.find(u=>u.id===h.from_id), to=users.find(u=>u.id===h.to_id);
          return (
            <div key={h.id} style={s.historyRow}>
              <span style={{fontSize:18}}>{h.to_id===me.id?'📥':'📤'}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:14,color:'#d0c0f0'}}>
                  <span style={{fontWeight:600,color:'#f0eaff'}}>{from?.name||'?'}</span>
                  <span style={{color:'#555'}}> → </span>
                  <span style={{fontWeight:600,color:'#f0eaff'}}>{to?.name||'?'}</span>
                  <span style={{color:from?.color,fontWeight:700}}> ★{h.amount} {from?.coin_name}</span>
                </div>
                <div style={{fontSize:12,color:'#6655a0',marginTop:3,fontStyle:'italic'}}>「{h.reason}」</div>
              </div>
              <div style={{fontSize:11,color:'#444',whiteSpace:'nowrap'}}>{new Date(h.created_at).toLocaleDateString('zh-TW')}</div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ── Shop Tab ──────────────────────────────────────────────
function ShopTab({ me, friends, shops, wallet, shopOwner, setShopOwner, users, onRedeem, onBack }) {
  const owner = shopOwner ? users.find(u=>u.id===shopOwner) : null;
  const items = shopOwner ? (shops[shopOwner]||[]) : [];

  if (owner) {
    const myCoins = wallet[shopOwner]||0;
    return (
      <div>
        <button style={s.backBtn} onClick={onBack}>← 返回</button>
        <div style={s.shopHeader}>
          <span style={{fontSize:36}}>{owner.avatar}</span>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:'#f0eaff'}}>{owner.name} 的商店</div>
            <div style={{fontSize:13,marginTop:3}}>
              你有 <span style={{color:owner.color,fontWeight:700}}>★ {myCoins}</span> {owner.coin_name}
            </div>
          </div>
        </div>
        {items.length===0 && <div style={s.empty}>這家店還沒有商品</div>}
        {items.map(item=>(
          <div key={item.id} style={{...s.itemCard,opacity:item.available?1:0.45}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <div style={{fontSize:15,fontWeight:600,color:'#f0eaff'}}>{item.name}</div>
              <div style={{color:owner.color,fontWeight:700}}>★ {item.cost}</div>
            </div>
            <div style={{fontSize:13,color:'#8870b0',marginBottom:10}}>{item.description}</div>
            {item.available
              ? <button style={{...s.redeemBtn,background:`linear-gradient(135deg,${owner.color}88,${owner.color})`}}
                  onClick={()=>onRedeem(item,owner.id)}>兌換</button>
              : <div style={{fontSize:12,color:'#555'}}>暫時無法兌換</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={s.sectionTitle}>朋友的商店</div>
      {friends.length===0 && <div style={s.empty}>還沒有朋友加入</div>}
      {friends.map(f=>{
        const coins=wallet[f.id]||0;
        return (
          <button key={f.id} style={s.shopPickRow} onClick={()=>setShopOwner(f.id)}>
            <span style={{fontSize:32}}>{f.avatar}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:600,color:'#f0eaff'}}>{f.name} 的商店</div>
              <div style={{fontSize:12,marginTop:3}}>
                你有 <span style={{color:f.color,fontWeight:600}}>★ {coins}</span> {f.coin_name}
                　{(shops[f.id]||[]).filter(i=>i.available).length} 件商品
              </div>
            </div>
            <span style={{color:'#555'}}>→</span>
          </button>
        );
      })}
    </div>
  );
}

// ── My Shop Tab ───────────────────────────────────────────
function MyShopTab({ me, myItems, newItem, setNewItem, onAdd, onToggle }) {
  return (
    <div>
      <div style={s.walletCard}>
        <div style={{fontSize:13,color:'#c8b8f0',marginBottom:6}}>你的商店用 <CoinBadge user={me} /> 標價</div>
        <div style={{fontSize:12,color:'#6655a0'}}>朋友送你星星後，就可以來這裡消費</div>
      </div>
      <div style={s.addCard}>
        <div style={{fontSize:14,fontWeight:700,color:'#c8b8f0',marginBottom:14}}>新增商品</div>
        <input style={s.input} placeholder="商品名稱" value={newItem.name}
          onChange={e=>setNewItem(p=>({...p,name:e.target.value}))} />
        <input style={s.input} placeholder="描述（選填）" value={newItem.desc}
          onChange={e=>setNewItem(p=>({...p,desc:e.target.value}))} />
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <span style={{fontSize:13,color:'#c8b8f0'}}>所需 <CoinBadge user={me} /></span>
          <div style={s.amtRow}>
            <button style={s.amtBtn} onClick={()=>setNewItem(p=>({...p,cost:Math.max(1,p.cost-1)}))}>－</button>
            <span style={s.amtNum}>{newItem.cost}</span>
            <button style={s.amtBtn} onClick={()=>setNewItem(p=>({...p,cost:p.cost+1}))}>＋</button>
          </div>
        </div>
        <button style={s.primaryBtn} onClick={onAdd}>上架商品</button>
      </div>
      <div style={s.sectionTitle}>目前商品</div>
      {myItems.length===0 && <div style={s.empty}>還沒有商品</div>}
      {myItems.map(item=>(
        <div key={item.id} style={{...s.itemCard,opacity:item.available?1:0.5}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
            <div style={{fontSize:15,fontWeight:600,color:'#f0eaff'}}>{item.name}</div>
            <div style={{color:me.color,fontWeight:700}}>★ {item.cost}</div>
          </div>
          {item.description && <div style={{fontSize:13,color:'#8870b0',marginBottom:8}}>{item.description}</div>}
          <button style={item.available?s.toggleOffBtn:s.toggleOnBtn} onClick={()=>onToggle(item)}>
            {item.available?'下架':'重新上架'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── 小元件 ─────────────────────────────────────────────────
function CoinBadge({ user, small }) {
  if (!user) return null;
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',gap:3,
      background:`${user.color}22`,border:`1px solid ${user.color}55`,
      borderRadius:20,padding:small?'2px 7px':'3px 10px',
      fontSize:small?11:13,color:user.color,fontWeight:600,
    }}>
      {user.avatar} {user.coin_name}
    </span>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modalBox} onClick={e=>e.stopPropagation()}>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────
const s = {
  root:{minHeight:'100vh',background:'#0e0a1a',color:'#f0eaff',fontFamily:"'Noto Sans TC',Georgia,serif",maxWidth:430,margin:'0 auto',position:'relative',paddingBottom:80},
  noise:{position:'fixed',inset:0,pointerEvents:'none',zIndex:0,opacity:0.04,backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",backgroundSize:'150px'},
  header:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 20px 14px',position:'sticky',top:0,zIndex:10,background:'rgba(14,10,26,0.9)',backdropFilter:'blur(12px)',borderBottom:'1px solid rgba(200,184,240,0.08)'},
  logo:{fontSize:18,fontWeight:700,letterSpacing:'0.08em',background:'linear-gradient(135deg,#e8d5ff,#ffd6fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'},
  avatarChip:{display:'flex',alignItems:'center',gap:6,background:'rgba(200,184,240,0.1)',border:'1px solid rgba(200,184,240,0.2)',borderRadius:20,padding:'5px 12px'},
  main:{padding:'16px 16px 20px',position:'relative',zIndex:1},
  loadingBar:{position:'fixed',top:0,left:0,right:0,height:2,background:'linear-gradient(90deg,#7b4fc4,#b06ad0)',zIndex:200,animation:'pulse 1s ease-in-out infinite'},
  walletCard:{background:'linear-gradient(135deg,#1e1535,#150f28)',border:'1px solid rgba(200,184,240,0.15)',borderRadius:20,padding:20,marginBottom:20,boxShadow:'0 8px 40px rgba(80,40,160,0.2)'},
  walletTop:{display:'flex',alignItems:'center',gap:12,marginBottom:16},
  walletName:{fontSize:16,fontWeight:700,color:'#f0eaff'},
  walletSub:{fontSize:12,color:'#6655a0',marginTop:3},
  coinList:{display:'flex',flexDirection:'column',gap:8},
  coinRow:{display:'flex',alignItems:'center',gap:10,background:'rgba(255,255,255,0.04)',borderRadius:12,padding:'10px 12px'},
  goShopBtn:{background:'rgba(200,184,240,0.1)',border:'1px solid rgba(200,184,240,0.2)',borderRadius:8,color:'#c8b8f0',fontSize:12,padding:'5px 10px',cursor:'pointer'},
  section:{marginBottom:24},
  sectionTitle:{fontSize:11,fontWeight:700,letterSpacing:'0.12em',color:'#6655a0',textTransform:'uppercase',marginBottom:10},
  friendRow:{display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(200,184,240,0.08)',borderRadius:14,padding:'12px 14px',marginBottom:8},
  friendName:{fontSize:15,fontWeight:600,color:'#f0eaff',marginBottom:4},
  outlineBtn:{background:'transparent',border:'1px solid rgba(200,184,240,0.25)',color:'#c8b8f0',borderRadius:9,padding:'6px 11px',fontSize:12,cursor:'pointer'},
  starBtn:{border:'none',color:'#fff',borderRadius:9,padding:'6px 12px',fontSize:12,cursor:'pointer',fontWeight:600},
  historyRow:{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'},
  nav:{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'rgba(14,10,26,0.96)',backdropFilter:'blur(20px)',borderTop:'1px solid rgba(200,184,240,0.08)',display:'flex',zIndex:100},
  navBtn:{flex:1,background:'none',border:'none',color:'#444',padding:'12px 0 16px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3},
  navActive:{color:'#c8b8f0'},
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',backdropFilter:'blur(8px)',zIndex:200,display:'flex',alignItems:'flex-end',justifyContent:'center'},
  modalBox:{background:'linear-gradient(180deg,#1e1535,#150f28)',border:'1px solid rgba(200,184,240,0.2)',borderRadius:'24px 24px 0 0',padding:'32px 24px 44px',width:'100%',maxWidth:430,position:'relative',boxShadow:'0 -20px 60px rgba(80,40,160,0.4)'},
  closeBtn:{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.06)',border:'none',color:'#888',borderRadius:8,width:32,height:32,cursor:'pointer'},
  modalTitle:{fontSize:20,fontWeight:700,color:'#f0eaff',marginBottom:8},
  modalNote:{fontSize:13,color:'#8870b0',marginBottom:20,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'},
  field:{marginBottom:18},
  label:{fontSize:11,color:'#6655a0',letterSpacing:'0.08em',display:'block',marginBottom:8,textTransform:'uppercase'},
  amtRow:{display:'flex',alignItems:'center',gap:16},
  amtBtn:{width:36,height:36,borderRadius:10,background:'rgba(200,184,240,0.1)',border:'1px solid rgba(200,184,240,0.2)',color:'#f0eaff',fontSize:18,cursor:'pointer'},
  amtNum:{fontSize:28,fontWeight:700,color:'#ffd700',minWidth:40,textAlign:'center'},
  textarea:{width:'100%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(200,184,240,0.2)',borderRadius:12,color:'#f0eaff',padding:'12px 14px',fontSize:14,resize:'none',height:90,outline:'none',boxSizing:'border-box',fontFamily:'inherit'},
  primaryBtn:{width:'100%',padding:14,background:'linear-gradient(135deg,#7b4fc4,#b06ad0)',border:'none',borderRadius:14,color:'#fff',fontSize:16,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 20px rgba(120,70,200,0.4)'},
  redeemCard:{background:'rgba(255,255,255,0.04)',borderRadius:14,padding:16,marginBottom:12,border:'1px solid rgba(200,184,240,0.12)'},
  redeemName:{fontSize:16,fontWeight:700,color:'#f0eaff',marginBottom:4},
  redeemDesc:{fontSize:13,color:'#8870b0',marginBottom:10},
  redeemCost:{fontSize:18,fontWeight:700,display:'flex',alignItems:'center',gap:6},
  backBtn:{background:'none',border:'none',color:'#8870b0',fontSize:14,cursor:'pointer',padding:'4px 0 16px'},
  shopHeader:{display:'flex',alignItems:'center',gap:14,marginBottom:20,padding:16,background:'rgba(255,255,255,0.03)',borderRadius:16,border:'1px solid rgba(200,184,240,0.08)'},
  shopPickRow:{display:'flex',alignItems:'center',gap:12,width:'100%',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(200,184,240,0.08)',borderRadius:14,padding:14,marginBottom:8,cursor:'pointer',textAlign:'left'},
  itemCard:{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(200,184,240,0.1)',borderRadius:14,padding:14,marginBottom:8},
  redeemBtn:{padding:'7px 16px',border:'none',borderRadius:9,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'},
  addCard:{background:'rgba(200,184,240,0.04)',border:'1px solid rgba(200,184,240,0.12)',borderRadius:16,padding:18,marginBottom:20},
  input:{width:'100%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(200,184,240,0.2)',borderRadius:10,color:'#f0eaff',padding:'10px 12px',fontSize:14,outline:'none',marginBottom:10,boxSizing:'border-box',fontFamily:'inherit'},
  toggleOffBtn:{padding:'6px 12px',background:'rgba(255,80,80,0.08)',border:'1px solid rgba(255,100,100,0.2)',borderRadius:7,color:'#ff8080',fontSize:12,cursor:'pointer'},
  toggleOnBtn:{padding:'6px 12px',background:'rgba(100,200,100,0.08)',border:'1px solid rgba(100,200,100,0.2)',borderRadius:7,color:'#80d080',fontSize:12,cursor:'pointer'},
  toast:{position:'fixed',top:80,left:'50%',transform:'translateX(-50%)',background:'linear-gradient(135deg,#3a2060,#5a3090)',border:'1px solid rgba(200,184,240,0.3)',color:'#f0eaff',padding:'10px 24px',borderRadius:20,fontSize:14,fontWeight:600,zIndex:500,boxShadow:'0 4px 20px rgba(80,40,160,0.4)',whiteSpace:'nowrap'},
  empty:{textAlign:'center',color:'#444',padding:'32px 0',fontSize:14},
};
