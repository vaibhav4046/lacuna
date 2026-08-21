import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { VoiceAssistantController, type VoiceAssistantContext, type VoiceAssistantSnapshot } from './assistant-controller';
import { BrowserVoiceRuntime } from './browser';
import { VoiceController } from './controller';
import { VoiceOperationExecutor } from './operations';

interface VoiceAssistantOwner {
  readonly runtime: BrowserVoiceRuntime;
  readonly voice: VoiceController;
  readonly executor: VoiceOperationExecutor;
  readonly assistant: VoiceAssistantController;
  dispose(): void;
}

function createVoiceAssistantOwner(
  base: string,
  navigate: (path: string) => void,
  context: VoiceAssistantContext,
): VoiceAssistantOwner {
  const runtime = new BrowserVoiceRuntime(base);
  const voice = new VoiceController(runtime);
  const executor = new VoiceOperationExecutor({ navigate });
  const assistant = new VoiceAssistantController(voice, executor, context);
  let disposed = false;
  return {
    runtime,
    voice,
    executor,
    assistant,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      assistant.dispose();
      // VoiceController owns runtime disposal, so the playback session closes once.
      voice.dispose();
    },
  };
}

export interface VoiceAssistantValue {
  readonly snapshot: VoiceAssistantSnapshot;
  readonly dockOpen: boolean;
  readonly openDock: () => void;
  readonly closeDock: () => void;
  readonly startListening: () => Promise<void>;
  readonly stopListening: () => void;
  readonly cancelSpeech: () => void;
  readonly bargeIn: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly replay: () => Promise<void>;
  readonly submitTyped: (text: string) => Promise<void>;
  readonly confirm: () => Promise<void>;
  readonly cancelPending: () => void;
}

const AssistantContext = createContext<VoiceAssistantValue | null>(null);

interface VoiceAssistantProviderProps extends VoiceAssistantContext {
  readonly base: string;
  readonly children: ReactNode;
}

/**
 * The shell owns this provider. Route-param changes update assistant context,
 * but never construct a second microphone, executor, playback session or
 * operation controller.
 */
export function VoiceAssistantProvider({
  base,
  currentRoute,
  scope,
  sessionKey,
  workspaceKey,
  children,
}: VoiceAssistantProviderProps) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const context = useMemo<VoiceAssistantContext>(() => ({
    currentRoute,
    scope,
    sessionKey,
    workspaceKey,
  }), [currentRoute, scope, sessionKey, workspaceKey]);
  const contextRef = useRef(context);
  contextRef.current = context;
  const [owner, setOwner] = useState<VoiceAssistantOwner | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceAssistantSnapshot | null>(null);
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    const created = createVoiceAssistantOwner(
      base,
      (path) => navigateRef.current(path),
      contextRef.current,
    );
    const unsubscribe = created.assistant.subscribe(setSnapshot);
    setOwner(created);
    return () => {
      unsubscribe();
      created.dispose();
    };
  }, [base]);

  useLayoutEffect(() => {
    if (owner !== null) owner.assistant.setContext(context);
  }, [context, owner]);

  const value = useMemo<VoiceAssistantValue | null>(() => owner === null || snapshot === null ? null : ({
    snapshot,
    dockOpen,
    openDock: () => setDockOpen(true),
    closeDock: () => setDockOpen(false),
    startListening: () => owner.voice.start(),
    stopListening: () => owner.voice.stop(),
    cancelSpeech: () => owner.voice.cancel(),
    bargeIn: () => owner.voice.bargeIn(),
    retry: () => owner.voice.retry(),
    replay: () => owner.voice.replay(),
    submitTyped: (text) => owner.voice.submitTyped(text),
    confirm: () => owner.assistant.confirm(),
    cancelPending: () => owner.assistant.cancelPending(),
  }), [dockOpen, owner, snapshot]);

  if (value === null) return null;
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useVoiceAssistant(): VoiceAssistantValue {
  const value = useContext(AssistantContext);
  if (value === null) throw new Error('useVoiceAssistant used outside VoiceAssistantProvider');
  return value;
}
