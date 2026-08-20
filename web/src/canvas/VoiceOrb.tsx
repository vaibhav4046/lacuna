import { useEffect, useRef, useState } from 'react';
import type { AudioSignal, VoiceState } from '../voice/states';

const SIZE = 300;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(media.matches);
    changed();
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return reduced;
}

function canMove(state: VoiceState, signal: AudioSignal): boolean {
  if ((state === 'LISTENING' || state === 'PARTIAL_TRANSCRIPT') && signal === 'microphone') return true;
  return state === 'SPEAKING' && signal === 'playback';
}

export interface VoiceOrbProps {
  readonly state?: VoiceState;
  readonly signal?: AudioSignal;
  readonly rms?: number;
  readonly waveform?: readonly number[];
}

/**
 * A deterministic audio meter. It has no clock, noise source or simulated
 * breathing. Every non-static coordinate comes from analyser samples supplied
 * by the live microphone or actual playback path.
 */
export function VoiceOrb({
  state = 'READY', signal = null, rms = 0, waveform = [],
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, SIZE, SIZE);

    const active = canMove(state, signal) && !reducedMotion;
    const measured = active ? Math.max(0, Math.min(1, rms * 12)) : 0;
    const radius = 82 + measured * 28;
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // A fixed sunflower packing. Positions never drift on their own.
    for (let index = 0; index < 280; index += 1) {
      const theta = index * 2.399963229728653;
      const distance = radius * Math.sqrt(index / 280);
      const edge = index / 280;
      context.globalAlpha = 0.18 + edge * 0.48;
      context.fillStyle = index % 41 === 0 ? '#8052FF' : '#8A8A8A';
      context.beginPath();
      context.arc(
        cx + Math.cos(theta) * distance,
        cy + Math.sin(theta) * distance,
        1 + measured * 0.35,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    // The ring is real time-domain audio, wrapped around the measured sphere.
    if (active && waveform.length > 1) {
      context.globalAlpha = 0.82;
      context.strokeStyle = signal === 'microphone' ? '#8052FF' : '#FFB829';
      context.lineWidth = 1.4;
      context.beginPath();
      for (let index = 0; index <= waveform.length; index += 1) {
        const sample = waveform[index % waveform.length] ?? 0;
        const angle = index / waveform.length * Math.PI * 2;
        const ring = radius + 13 + sample * 30;
        const x = cx + Math.cos(angle) * ring;
        const y = cy + Math.sin(angle) * ring;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.globalAlpha = 1;
  }, [reducedMotion, rms, signal, state, waveform]);

  return (
    <figure style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: '10px' }}>
      <canvas
        ref={canvasRef}
        style={{ width: 'min(300px, 100%)', aspectRatio: '1', flexShrink: 0 }}
        role="img"
        aria-label={`Voice ${state.toLowerCase().replaceAll('_', ' ')}. ${canMove(state, signal) && !reducedMotion ? `${signal} analyser active.` : 'Orb static.'}`}
      />
      <figcaption style={{ fontSize: '12px', color: '#7A7A7A', textAlign: 'center' }}>
        {reducedMotion ? 'Static by reduced-motion preference.'
          : canMove(state, signal) ? `${signal === 'microphone' ? 'Microphone' : 'Playback'} analyser.`
            : 'No live audio signal.'}
      </figcaption>
    </figure>
  );
}
