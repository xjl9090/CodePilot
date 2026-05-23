'use client';

import { useEffect, useState } from 'react';
import { MonolithIcon } from '@/components/brand/MonolithIcon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

/**
 * NewChatWelcome — single-line hero shown directly above the composer
 * on the new-chat page (when no session exists or no messages have
 * been sent yet).
 *
 * Layout (mirrors the ChatGPT / Claude / Codex new-chat pattern):
 *
 *     [Monolith logo] [Random welcome message in large text]
 *
 * The welcome line rotates across 6 short prompts, but the
 * randomisation runs client-side only (useEffect after mount). An
 * earlier version used `useMemo(() => Math.random(), [])` which
 * picks on every render — including the server pass and the first
 * client hydration pass — and ran Math.random twice with different
 * results, producing a hydration mismatch:
 *
 *   client: "How can I assist you?"
 *   server: "What would you like to build?"
 *
 * Hydration warnings break Phase 7b vibrancy smoke (Codex round 3
 * review): they leave a noisy DevTools console that masks the real
 * UI issues we're trying to chase. Initial state is the first
 * welcome key so server and client render the SAME string; once
 * useEffect runs we swap in the random pick.
 */

const WELCOME_KEYS: ReadonlyArray<TranslationKey> = [
  'chat.newChat.welcome.1' as TranslationKey,
  'chat.newChat.welcome.2' as TranslationKey,
  'chat.newChat.welcome.3' as TranslationKey,
  'chat.newChat.welcome.4' as TranslationKey,
  'chat.newChat.welcome.5' as TranslationKey,
  'chat.newChat.welcome.6' as TranslationKey,
];

export function NewChatWelcome() {
  const { t } = useTranslation();
  const [welcomeKey, setWelcomeKey] = useState<TranslationKey>(WELCOME_KEYS[0]);
  useEffect(() => {
    setWelcomeKey(WELCOME_KEYS[Math.floor(Math.random() * WELCOME_KEYS.length)]);
  }, []);

  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <MonolithIcon className="h-9 w-9 shrink-0" />
      <h1 className="text-3xl font-medium tracking-tight text-foreground leading-none">
        {t(welcomeKey)}
      </h1>
    </div>
  );
}
