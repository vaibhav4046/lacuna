import { useEffect, useId, useRef, useState } from 'react';
import type { AudioSignal, VoiceState } from '../voice/states';
import { voiceOrbFrame } from '../voice/orb';

const SIZE = 320;
const PARTICLES = 360;
const GOLDEN_ANGLE = 2.399963229728653;

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

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

export interface VoiceOrbProps {
  readonly state?: VoiceState;
  readonly signal?: AudioSignal;
  readonly rms?: number;
  readonly waveform?: readonly number[];
}

/**
 * Lacuna's live speech instrument. The field has no clock, random source or
 * simulated breathing: displacement comes only from microphone/playback
 * analyser frames. Every other lifecycle state resolves to a static aperture.
 */
export function VoiceOrb({
  state = 'READY', signal = null, rms = 0, waveform = [],
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captionId = useId();
  const reducedMotion = useReducedMotion();
  const frame = voiceOrbFrame(state, signal, rms, reducedMotion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const radius = 78 + frame.measured * 25;
    const activeSamples = frame.active && waveform.length > 1 ? waveform : [];

    const atmosphere = context.createRadialGradient(cx, cy, 4, cx, cy, 142);
    atmosphere.addColorStop(0, frame.active ? 'rgba(255,184,41,0.075)' : 'rgba(255,255,255,0.025)');
    atmosphere.addColorStop(0.52, 'rgba(255,255,255,0.012)');
    atmosphere.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = atmosphere;
    context.fillRect(0, 0, SIZE, SIZE);

    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < PARTICLES; index += 1) {
      const edge = Math.sqrt((index + 0.5) / PARTICLES);
      const rawSample = activeSamples.length === 0
        ? 0
        : activeSamples[index % activeSamples.length] ?? 0;
      const sample = clamp(rawSample, -1, 1);
      const theta = index * GOLDEN_ANGLE + sample * 0.14;
      const depth = 0.58 + 0.42 * ((Math.sin(theta * 0.73) + 1) / 2);
      const audioDisplacement = sample * (5 + edge * 19);
      const pressure = frame.measured * Math.pow(edge, 1.7) * 18;
      const distance = radius * edge + audioDisplacement + pressure;
      const x = cx + Math.cos(theta) * distance;
      const y = cy + Math.sin(theta) * distance * (0.91 + depth * 0.09);
      const highlighted = index % 47 === 0;

      context.globalAlpha = 0.14 + edge * 0.34 + depth * 0.18;
      context.fillStyle = highlighted
        ? '#FFB829'
        : frame.active && signal === 'playback'
          ? (index % 5 === 0 ? '#FFD98E' : '#A8A8A8')
          : (index % 7 === 0 ? '#FFFFFF' : '#868686');
      context.beginPath();
      context.arc(x, y, 0.62 + depth * 0.78 + frame.measured * 0.22, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    // The perimeter is the measured time-domain signal, never an idle loop.
    if (activeSamples.length > 1) {
      context.save();
      context.globalAlpha = 0.9;
      context.strokeStyle = signal === 'playback' ? '#FFB829' : '#FFFFFF';
      context.shadowColor = signal === 'playback' ? 'rgba(255,184,41,0.38)' : 'rgba(255,255,255,0.22)';
      context.shadowBlur = 10;
      context.lineWidth = 1.25;
      context.beginPath();
      for (let index = 0; index <= activeSamples.length; index += 1) {
        const sample = clamp(activeSamples[index % activeSamples.length] ?? 0, -1, 1);
        const angle = index / activeSamples.length * Math.PI * 2 - Math.PI / 2;
        const ring = radius + 19 + sample * 32;
        const x = cx + Math.cos(angle) * ring;
        const y = cy + Math.sin(angle) * ring;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.stroke();
      context.restore();
    }

    // An open aperture is the static anchor and the visual relationship to the
    // approved Lacuna mark. Its small gold node is intentionally not violet.
    const apertureRadius = 27 + frame.measured * 3;
    const start = -Math.PI * 0.43;
    const end = Math.PI * 1.22;
    context.save();
    context.globalAlpha = frame.active ? 0.92 : 0.68;
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 1.5;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(cx, cy, apertureRadius, start, end);
    context.stroke();
    const nodeX = cx + Math.cos(start) * apertureRadius;
    const nodeY = cy + Math.sin(start) * apertureRadius;
    context.fillStyle = '#FFB829';
    context.shadowColor = 'rgba(255,184,41,0.48)';
    context.shadowBlur = frame.active ? 9 : 4;
    context.beginPath();
    context.arc(nodeX, nodeY, 2.4 + frame.measured * 0.45, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }, [frame.active, frame.measured, reducedMotion, signal, state, waveform]);

  const analyserLabel = frame.active
    ? `${signal === 'microphone' ? 'Live microphone' : 'Live playback'} analyser drives the field.`
    : 'No live audio signal. The field is static.';

  return (
    <figure style={{ margin: 0, width: '100%', display: 'grid', justifyItems: 'center', gap: '10px' }}>
      <canvas
        ref={canvasRef}
        style={{ width: 'min(320px, 100%)', aspectRatio: '1', flexShrink: 0 }}
        role="img"
        aria-label={`Voice ${state.toLowerCase().replaceAll('_', ' ')}.`}
        aria-describedby={captionId}
      />
      <figcaption id={captionId} style={{ maxWidth: '34ch', fontSize: '12px', color: '#7A7A7A', textAlign: 'center' }}>
        {reducedMotion ? 'Static by reduced-motion preference.' : analyserLabel}
      </figcaption>
    </figure>
  );
}
