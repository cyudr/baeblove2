import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Sparkles,
  Send,
  RotateCcw,
  Loader2,
  AlertCircle,
  Bot,
  User,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { doesNoteMatchProfile, doesRecordMatchProfile } from '../../utils/careInterpreter';
import {
  buildGeminiSystemInstruction,
  type GeminiChatFocus,
} from '../../utils/geminiContextBuilder';
import { formatAgeFromBirthDate, getLocalTodayDateStr } from '../../utils/ageCalculator';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

interface AskGeminiModalProps {
  isOpen: boolean;
  onClose: () => void;
  focus: GeminiChatFocus;
}

const STARTER_PROMPTS: Record<GeminiChatFocus, string[]> = {
  growth: [
    'Summarize recent weight & length trends and WHO percentiles.',
    'How is the daily weight gain rate (g/day) looking?',
    'Review recent temperature logs and any patterns to watch.',
    'Compare growth progress with recent feeding intake.',
  ],
  routine: [
    "Summarize today's milk intake vs recommended daily target.",
    'Review recent diaper output and stool color patterns.',
    'How do feeding volumes and durations trend over recent days?',
    'Is feeding intake aligning well with recent weight gain?',
  ],
};

/**
 * Safe inline markdown formatter (bold **...** and inline code `...`) rendered purely as React nodes.
 */
function renderInlineText(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={idx} className="font-bold text-stone-900 dark:text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={idx}
          className="px-1 py-0.5 rounded bg-stone-200/70 dark:bg-stone-700/80 font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
}

function FormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`${keyPrefix}-ul`} className="list-disc pl-4 space-y-1 my-1.5">
        {listItems.map((item, idx) => (
          <li key={idx} className="leading-relaxed">
            {renderInlineText(item)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const bulletMatch = /^[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      return;
    }

    flushList(`line-${idx}`);

    if (!line) {
      return;
    }

    const headingMatch = /^#{1,3}\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push(
        <p key={`h-${idx}`} className="font-bold text-stone-900 dark:text-white mt-2 mb-1">
          {renderInlineText(headingMatch[1])}
        </p>
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="leading-relaxed mb-1.5 last:mb-0">
        {renderInlineText(line)}
      </p>
    );
  });

  flushList('end');

  return <div className="text-xs sm:text-[13px]">{blocks}</div>;
}

export const AskGeminiModal: React.FC<AskGeminiModalProps> = ({
  isOpen,
  onClose,
  focus,
}) => {
  const {
    activeProfile,
    activeBabyMeasurements,
    activeFetalMeasurements,
    growthRecords,
    routineRecords,
    noteRecords,
    unitSystem,
  } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const profileGrowth = useMemo(
    () =>
      activeProfile
        ? growthRecords.filter((g) => doesRecordMatchProfile(g, activeProfile))
        : growthRecords,
    [growthRecords, activeProfile]
  );

  const profileRoutine = useMemo(
    () =>
      activeProfile
        ? routineRecords.filter((r) => doesRecordMatchProfile(r, activeProfile))
        : routineRecords,
    [routineRecords, activeProfile]
  );

  const profileNotes = useMemo(
    () =>
      activeProfile
        ? noteRecords.filter((n) => doesNoteMatchProfile(n, activeProfile))
        : noteRecords,
    [noteRecords, activeProfile]
  );

  const systemInstruction = useMemo(
    () =>
      buildGeminiSystemInstruction({
        focus,
        activeProfile,
        unitSystem,
        growthRecords: profileGrowth,
        routineRecords: profileRoutine,
        noteRecords: profileNotes,
        babyMeasurements: activeBabyMeasurements,
        fetalMeasurements: activeFetalMeasurements,
      }),
    [
      focus,
      activeProfile,
      unitSystem,
      profileGrowth,
      profileRoutine,
      profileNotes,
      activeBabyMeasurements,
      activeFetalMeasurements,
    ]
  );

  const profileAgeBadge = useMemo(() => {
    if (!activeProfile) return null;
    if (activeProfile.type === 'baby') {
      return formatAgeFromBirthDate(activeProfile.dateOfEvent, getLocalTodayDateStr());
    }
    return `EDD ${activeProfile.dateOfEvent}`;
  }, [activeProfile]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending, error]);

  if (!isOpen) return null;

  const sendMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setInputText('');
    setError(null);
    setIsSending(true);

    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          systemInstruction,
          thinkingLevel: 'LOW',
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };

      if (!response.ok || !data.text) {
        setError(data.error || `Gemini request failed (${response.status}).`);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `model-${Date.now()}`,
          role: 'model',
          text: data.text!,
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to reach Gemini service: ${err.message}`
          : 'Unable to reach Gemini service. Please try again.'
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(inputText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputText);
    }
  };

  const handleRetryLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || isSending) return;
    // Re-send existing history without duplicating the last user message
    setError(null);
    setIsSending(true);
    void (async () => {
      try {
        const response = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: messages.map((m) => ({ role: m.role, text: m.text })),
            systemInstruction,
            thinkingLevel: 'LOW',
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
        };
        if (!response.ok || !data.text) {
          setError(data.error || `Gemini request failed (${response.status}).`);
          return;
        }
        setMessages((prev) => [
          ...prev,
          { id: `model-${Date.now()}`, role: 'model', text: data.text! },
        ]);
      } catch (err) {
        setError(
          err instanceof Error
            ? `Unable to reach Gemini service: ${err.message}`
            : 'Unable to reach Gemini service.'
        );
      } finally {
        setIsSending(false);
      }
    })();
  };

  const handleResetChat = () => {
    setMessages([]);
    setError(null);
    setInputText('');
    inputRef.current?.focus();
  };

  const starters = STARTER_PROMPTS[focus];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 dark:bg-black/75 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-stone-900 rounded-3xl max-w-2xl w-full h-[min(86vh,680px)] flex flex-col shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden transition-colors">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3 bg-linear-to-r from-emerald-50/80 via-teal-50/50 to-indigo-50/60 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-indigo-950/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-linear-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-stone-900 dark:text-white truncate">
                Ask Gemini · {focus === 'growth' ? 'Growth Insights' : 'Routine Insights'}
              </h3>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                {activeProfile ? (
                  <>
                    Context: <strong className="text-stone-700 dark:text-stone-200">{activeProfile.name}</strong>
                    {profileAgeBadge ? ` (${profileAgeBadge})` : ''} · {profileGrowth.length} growth &amp; {profileRoutine.length} routine logs
                  </>
                ) : (
                  <>Context: {profileGrowth.length} growth &amp; {profileRoutine.length} routine logs</>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleResetChat}
                disabled={isSending}
                title="Start a new chat"
                className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 dark:text-stone-300 bg-white/80 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">New Chat</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Ask Gemini chat"
              className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-xl hover:bg-white/80 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-center text-center px-2 py-6 space-y-5">
              <div className="space-y-1.5 max-w-md">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <Bot className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                  Ask anything about {activeProfile ? `${activeProfile.name}'s` : 'your loaded'} data
                </h4>
                <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
                  Gemini has access to your currently loaded growth logs, WHO checkups, feeding volumes, diaper &amp; stool logs, and care notes.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
                {starters.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    className="text-left px-3.5 py-2.5 rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50/80 dark:bg-stone-800/70 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:border-emerald-300 dark:hover:border-emerald-800 text-xs text-stone-700 dark:text-stone-200 font-medium transition-colors cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isUser && (
                      <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                        isUser
                          ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap'
                          : 'bg-stone-100/90 dark:bg-stone-800/90 text-stone-800 dark:text-stone-200 border border-stone-200/70 dark:border-stone-700/70'
                      }`}
                    >
                      {isUser ? msg.text : <FormattedMessage text={msg.text} />}
                    </div>
                    {isUser && (
                      <div className="w-7 h-7 rounded-xl bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}

              {isSending && (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="rounded-2xl px-3.5 py-2.5 bg-stone-100/90 dark:bg-stone-800/90 border border-stone-200/70 dark:border-stone-700/70 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                    <span>Analyzing loaded records...</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-2xl p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span>{error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRetryLast}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] shrink-0 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}
            </>
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* Input Footer */}
        <form
          onSubmit={handleSubmit}
          className="px-4 sm:px-5 py-3 border-t border-stone-100 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/90 space-y-2"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about growth trends, feeds, diapers, or milestones..."
              disabled={isSending}
              className="flex-1 resize-none rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3.5 py-2.5 text-xs sm:text-sm text-stone-900 dark:text-white placeholder:text-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="px-4 py-2.5 h-[42px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 text-center">
            AI responses are for informational support only and do not replace professional pediatric medical advice.
          </p>
        </form>
      </div>
    </div>
  );
};
