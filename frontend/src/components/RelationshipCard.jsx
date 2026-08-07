import React from 'react';
import { Heart, Sparkles, Trophy, Shield, Flame, Compass, Gift, Award } from 'lucide-react';

export default function RelationshipCard({ relationshipStatus, onOpenShop, onClose }) {
  if (!relationshipStatus) return null;

  const {
    active_route = 'ROMANTIC',
    calculated_stage = 1,
    affinity_xp = 50,
    star_hearts = 100,
    romance_val = 20,
    affection_val = 50,
    control_val = 0,
    obsession_val = 10
  } = relationshipStatus;

  const STAGE_TITLES = {
    0: 'Lvl 0: Assistant',
    1: 'Lvl 1: Acquaintance',
    2: 'Lvl 2: Good Friend',
    3: 'Lvl 3: Close Confidant',
    4: 'Lvl 4: Sweetheart',
    5: 'Lvl 5: Soulmate'
  };

  const ROUTE_COLORS = {
    ROMANTIC: '#f43f5e',
    TSUNDERE: '#f97316',
    PLATONIC: '#eab308',
    YANDERE: '#a855f7',
    NEMESIS: '#64748b',
    MENTOR: '#3b82f6'
  };

  const routeColor = ROUTE_COLORS[active_route] || '#f43f5e';
  const stageTitle = STAGE_TITLES[calculated_stage] || `Lvl ${calculated_stage}`;
  const nextLevelXp = (calculated_stage + 1) * 300;
  const xpPercent = Math.min(100, Math.round((affinity_xp / nextLevelXp) * 100));

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '420px',
      maxWidth: '90vw',
      background: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(16px)',
      border: `1px solid ${routeColor}44`,
      borderRadius: '20px',
      padding: '24px',
      boxShadow: `0 20px 50px rgba(0,0,0,0.5), 0 0 30px ${routeColor}22`,
      color: '#f8fafc',
      zIndex: 10000,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '12px',
            background: `linear-gradient(135deg, ${routeColor} 0%, #881337 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 4px 14px ${routeColor}66`
          }}>
            <Heart style={{ width: '20px', height: '20px', color: '#ffffff' }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.02em' }}>Yuki Relationship Card</h3>
            <span style={{ fontSize: '0.75rem', color: routeColor, fontWeight: 600 }}>Route: {active_route}</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        )}
      </div>

      {/* Stage Badge & Currency */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.7)',
        borderRadius: '14px',
        padding: '14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        border: '1px solid rgba(255,255,255,0.06)'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Relationship Rank</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>{stageTitle}</div>
        </div>
        <div style={{
          background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
          padding: '6px 14px',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: 700,
          fontSize: '0.85rem',
          boxShadow: '0 4px 12px rgba(236,72,153,0.3)'
        }}>
          💖 {star_hearts} Stars
        </div>
      </div>

      {/* Affinity XP Progress Bar */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '6px' }}>
          <span>Affinity XP Progress</span>
          <span>{affinity_xp} / {nextLevelXp} XP ({xpPercent}%)</span>
        </div>
        <div style={{ height: '10px', width: '100%', background: 'rgba(51, 65, 85, 0.8)', borderRadius: '5px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${xpPercent}%`,
            background: `linear-gradient(90deg, ${routeColor} 0%, #f43f5e 100%)`,
            borderRadius: '5px',
            transition: 'width 0.5s ease'
          }} />
        </div>
      </div>

      {/* Relationship Vectors Matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Romance Vector</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f43f5e', marginTop: '2px' }}>{romance_val} / 100</div>
        </div>
        <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Affection Vector</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#10b981', marginTop: '2px' }}>{affection_val} / 100</div>
        </div>
        <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Control Vector</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#3b82f6', marginTop: '2px' }}>{control_val} / 100</div>
        </div>
        <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Obsession Vector</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#a855f7', marginTop: '2px' }}>{obsession_val} / 100</div>
        </div>
      </div>


    </div>
  );
}
