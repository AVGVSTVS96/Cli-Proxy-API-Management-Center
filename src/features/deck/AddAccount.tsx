import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useThemeStore } from '@/stores';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import { useOAuthFlows } from '@/features/oauth/hooks/useOAuthFlows';
import { OAUTH_PROVIDERS, resolveThemedIcon } from '@/features/oauth/providers';

const providers = OAUTH_PROVIDERS.filter((card) => card.id === 'anthropic' || card.id === 'codex');

export function AddAccount() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useThemeStore((state) => state.resolvedTheme);
  const focused = useRef<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const flows = useOAuthFlows({
    providerCards: providers,
    isFocused: (id) => focused.current === id,
  });
  const card = providers.find((item) => item.id === provider);

  const close = () => {
    if (provider) flows.dismissSuccess(provider);
    focused.current = null;
    setOpen(false);
  };

  const start = (id: string) => {
    focused.current = id;
    setProvider(id);
    setOpen(true);
    if (!flows.states[id]?.status) void flows.startAuth(id);
  };

  return (
    <>
      <div className="account-actions">
        <Button size="sm" onClick={() => start('anthropic')}>
          {t('auth_login.add_claude_account')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => start('codex')}>
          {t('auth_login.add_chatgpt_account')}
        </Button>
        <Link to="/oauth">{t('auth_login.other_providers')}</Link>
      </div>
      {card && (
        <OAuthFlowDialog
          open={open}
          providerId={card.id}
          heading={{
            title: t(card.titleKey),
            caption: t('auth_login.method_browser'),
            icon: resolveThemedIcon(card.icon, theme),
          }}
          state={flows.states[card.id] ?? {}}
          text={(suffix) => flows.providerText(card.id, suffix)}
          supportsCallback
          onStart={() => void flows.startAuth(card.id)}
          onCancel={() => void flows.cancelAuth(card.id)}
          onCallbackChange={(value) => flows.setCallbackInput(card.id, value)}
          onCallbackSubmit={() => void flows.submitCallback(card.id)}
          onViewAuthFiles={() => navigate('/auth-files')}
          onClose={close}
        />
      )}
    </>
  );
}
