import React, { useState } from 'react';
import { ShoppingBag, Gift, Sparkles, Coffee, Utensils, Glasses, Shirt } from 'lucide-react';
import { API_BASE } from '../api';

const CATALOG = [
  { id: 'boba_tea', name: 'Boba Tea', category: 'food', cost: 50, icon: '🧋', desc: '+15 Affection, +10 Happiness' },
  { id: 'strawberry_cake', name: 'Strawberry Shortcake', category: 'food', cost: 100, icon: '🍰', desc: '+25 Affection, +15 Happiness' },
  { id: 'warm_latte', name: 'Warm Latte', category: 'food', cost: 40, icon: '☕', desc: '-20 Stress, +10 Energy' },
  { id: 'cat_ears', name: 'Neko Cat Ears', category: 'wearable', cost: 200, icon: '🐱', desc: 'VRM Cosmetic Prop' },
  { id: 'reading_glasses', name: 'Reading Glasses', category: 'wearable', cost: 150, icon: '👓', desc: 'VRM Cosmetic Prop' },
  { id: 'cozy_hoodie', name: 'Cozy Oversized Hoodie', category: 'wearable', cost: 350, icon: '🧥', desc: 'Unlocked Outfit' }
];

export default function YukiShopModal({ starHearts = 100, onPurchaseComplete, onClose }) {
  const [buyingId, setBuyingId] = useState(null);
  const [msg, setMsg] = useState('');

  const handleBuy = async (item) => {
    if (starHearts < item.cost) {
      setMsg("Not enough Star Hearts! Complete tasks to earn more.");
      setTimeout(() => setMsg(''), 3000);
      return;
    }

    setBuyingId(item.id);
    try {
      const res = await fetch(`${API_BASE}/api/relationship/gift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          name: item.name,
          category: item.category,
          cost: item.cost
        })
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`Successfully bought ${item.name}! Yuki loved it 💕`);
        if (onPurchaseComplete) onPurchaseComplete(data);
      } else {
        setMsg(data.detail || "Purchase failed.");
      }
    } catch {
      setMsg("Connection error.");
    } finally {
      setBuyingId(null);
      setTimeout(() => setMsg(''), 3000);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '500px',
      maxWidth: '92vw',
      background: 'rgba(15, 23, 42, 0.96)',
      backdropFilter: 'blur(18px)',
      border: '1px solid rgba(244, 63, 94, 0.3)',
      borderRadius: '24px',
      padding: '24px',
      boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 30px rgba(244,63,94,0.15)',
      color: '#f8fafc',
      zIndex: 10001,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #f43f5e 0%, #be185d 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(244,63,94,0.4)'
          }}>
            <ShoppingBag style={{ width: '22px', height: '22px', color: '#ffffff' }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Yuki Gift & Cosmetic Shop</h3>
            <span style={{ fontSize: '0.75rem', color: '#fda4af' }}>Balance: 💖 {starHearts} Star Hearts</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        )}
      </div>

      {msg && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.2)',
          border: '1px solid rgba(244, 63, 94, 0.4)',
          borderRadius: '10px',
          padding: '8px 12px',
          fontSize: '0.8rem',
          color: '#fecdd3',
          marginBottom: '14px',
          textAlign: 'center'
        }}>
          {msg}
        </div>
      )}

      {/* Catalog Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        maxHeight: '340px',
        overflowY: 'auto',
        paddingRight: '4px'
      }}>
        {CATALOG.map(item => (
          <div key={item.id} style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '14px',
            padding: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>{item.icon}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc' }}>{item.name}</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '2px' }}>{item.desc}</div>
            </div>
            <button
              onClick={() => handleBuy(item)}
              disabled={buyingId === item.id || starHearts < item.cost}
              style={{
                marginTop: '10px',
                padding: '6px 10px',
                borderRadius: '8px',
                background: starHearts >= item.cost ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(51, 65, 85, 0.5)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.75rem',
                cursor: starHearts >= item.cost ? 'pointer' : 'not-allowed',
                opacity: buyingId === item.id ? 0.7 : 1
              }}
            >
              {buyingId === item.id ? 'Buying...' : `Buy for 💖 ${item.cost}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
