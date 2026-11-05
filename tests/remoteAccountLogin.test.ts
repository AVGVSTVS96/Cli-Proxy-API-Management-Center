import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import type { ProviderFlowState } from '@/features/oauth/hooks/useOAuthFlows';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import ko from '@/i18n/locales/ko.json';
import vi from '@/i18n/locales/vi.json';
import tr from '@/i18n/locales/tr.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const renderDialog = (providerId: string, state: ProviderFlowState) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(OAuthFlowDialog, {
        open: true,
        providerId,
        heading: { title: providerId, caption: '', icon: '' },
        state,
        text: (suffix: string) => i18n.t(`auth_login.${providerId}_${suffix}`),
        supportsCallback: true,
        onStart: () => {},
        onCancel: () => {},
        onCallbackChange: () => {},
        onCallbackSubmit: () => {},
        onViewAuthFiles: () => {},
        onClose: () => {},
      })
    )
  );

describe('adding an account from another device', () => {
  test('Claude asks for the code its page shows, as a required step', () => {
    const html = renderDialog('anthropic', {
      status: 'waiting',
      flow: 'code',
      state: 'st',
      url: 'https://claude.ai/oauth/authorize?redirect_uri=x',
    });
    expect(html).toContain(en.auth_login.paste_code_label);
    expect(html).toContain(en.auth_login.paste_code_hint);
    expect(html).not.toContain(en.auth_login.optional_step);
  });

  test('ChatGPT shows a device code and no callback field', () => {
    const html = renderDialog('codex', {
      status: 'waiting',
      flow: 'device',
      state: 'st',
      userCode: 'ABCD-EFGHI',
      url: 'https://auth.openai.com/codex/device',
    });
    expect(html).toContain('ABCD-EFGHI');
    expect(html).toContain(en.auth_login.device_copy_and_open);
    expect(html).toContain('chatgpt.com/#settings/Security');
    expect(html).not.toContain('<input');
  });

  test('every locale has the new labels', () => {
    const keys = [
      'paste_code_label',
      'paste_code_hint',
      'paste_code_placeholder',
      'device_copy_and_open',
      'codex_device_hint',
      'codex_device_settings_link',
    ] as const;
    for (const locale of [en, zhCN, zhTW, ru, ko, vi, tr]) {
      for (const key of keys) expect(locale.auth_login[key]).toBeTruthy();
    }
  });
});
