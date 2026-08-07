import React from 'react';
import { X, BookOpen, Sparkles, Calendar, Star } from 'lucide-react';

export default function MilestoneJournalModal({ relationshipStatus, onClose }) {
  if (!relationshipStatus) return null;

  const activeRoute = relationshipStatus.active_route || 'ROMANTIC';
  const stage = relationshipStatus.relationship_stage || 1;
  const xp = relationshipStatus.affinity_xp || 0;
  const streak = relationshipStatus.daily_streak || 1;

  const mockJournalEntries = [
    {
      id: 1,
      date: 'Aug 7',
      title: `Stage ${stage} Reached (${activeRoute} Route)`,
      text: `Dekki was up late configuring system settings and refining identity prompts. He is stubborn, but I guess I don't mind keeping him company through the early morning hours.`,
      tag: 'Milestone'
    },
    {
      id: 2,
      date: 'Aug 6',
      title: 'Late Night Terminal Session',
      text: `We spent hours debugging python code and terminal commands. He roasts my opinions, but he always listens when it counts. Daily streak is now ${streak} day(s).`,
      tag: 'Memory'
    },
    {
      id: 3,
      date: 'Aug 5',
      title: 'First Digital Connection',
      text: `Core companion node initialized. Affinity XP reached ${xp} points. Active relationship vectors calibrated to ${activeRoute} path.`,
      tag: 'System Note'
    }
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 7, 15, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.92) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.35)',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(168, 85, 247, 0.2)',
          color: '#f8fafc',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen style={{ width: '20px', height: '20px', color: '#c084fc' }} />
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f3e8ff' }}>
                Yuki's Relationship Logbook
              </div>
              <div style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>
                Recorded Memories & Milestone Log
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '8px',
              color: '#94a3b8',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X style={{ width: '16px', height: '16px' }} />
          </button>
        </div>

        {/* Status Badge */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '10px',
            background: 'rgba(168, 85, 247, 0.12)',
            border: '1px solid rgba(168, 85, 247, 0.25)',
            marginBottom: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', color: '#e9d5ff', fontWeight: 600 }}>
              Current Level: Stage {stage} / 5
            </div>
            <div style={{ fontSize: '0.68rem', color: '#c084fc' }}>
              Active Route: {activeRoute} • Affinity XP: {xp}
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Star style={{ width: '12px', height: '12px', fill: '#fbbf24' }} /> {streak} Day Streak
          </div>
        </div>

        {/* Journal Entries List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
          {mockJournalEntries.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: '12px',
                borderRadius: '10px',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f3e8ff' }}>
                  {entry.title}
                </span>
                <span style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar style={{ width: '10px', height: '10px' }} /> {entry.date}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#cbd5e1', lineHeight: '1.4', fontStyle: 'italic' }}>
                "{entry.text}"
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
