import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ASSETS,
  PAYMENT_METHODS,
  createQuote,
  createSellQuote,
  createSwapQuote,
  validateCryptoAddress,
  type Asset,
  type OrderKind,
  type PaymentMethod,
} from '@skalet/core';
import { C, styles as s } from '../src/styles';
import { useTelegram } from '../src/telegram';
import { API, AuthPanel, loadToken, saveToken } from '../src/AuthPanel';
import { useI18n } from '../src/i18n';

type Tab = 'home' | 'trade' | 'activity' | 'settings';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);

export default function Home() {
  const router = useRouter();
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState<Tab>('home');
  const [kind, setKind] = useState<OrderKind>('buy');

  // Selected Assets & Providers
  const [selectedAsset, setSelectedAsset] = useState<Asset>(ASSETS[0]);
  const [targetAsset, setTargetAsset] = useState<Asset>(ASSETS[1]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PAYMENT_METHODS[0]);
  const [assetPickerTarget, setAssetPickerTarget] = useState<'source' | 'target' | null>(null);

  // Form inputs
  const [amountFiat, setAmountFiat] = useState('25000');
  const [cryptoAmount, setCryptoAmount] = useState('0.001');
  const [swapSourceAmount, setSwapSourceAmount] = useState('0.001');
  const [receiveAddress, setReceiveAddress] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('+228 ');
  const [payoutName, setPayoutName] = useState('');

  // States & Statuses
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [orders, setOrders] = useState<Record<string, any>[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, any> | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'buy' | 'sell' | 'swap'>('all');

  // Interactive Settings Accordion State
  const [expandedSetting, setExpandedSetting] = useState<'kyc' | 'mfa' | 'support' | 'auth' | null>(null);

  // Support
  const [ticketCategory, setTicketCategory] = useState('GENERAL');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketNotice, setTicketNotice] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);

  // Account & Security
  const [kycStatus, setKycStatus] = useState('NOT_SUBMITTED');
  const [kycBusy, setKycBusy] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNotice, setMfaNotice] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  const idempotencyKey = useRef<string | null>(null);
  const quoteAttempt = useRef<{ id?: string; expiresAt?: string } | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const telegram = useTelegram();

  const navItems: { tab: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = useMemo(() => [
    { tab: 'home', label: t.navHome, icon: 'home-outline', activeIcon: 'home' },
    { tab: 'trade', label: t.navTrade, icon: 'swap-horizontal-outline', activeIcon: 'swap-horizontal' },
    { tab: 'activity', label: t.navActivity, icon: 'receipt-outline', activeIcon: 'receipt' },
    { tab: 'settings', label: t.navSettings, icon: 'settings-outline', activeIcon: 'settings' },
  ], [t]);

  const amountNumber = useMemo(() => Math.max(0, Number(amountFiat.replace(/\s+/g, '').replace(',', '.')) || 0), [amountFiat]);

  // Live quotes computation
  const liveQuote = useMemo(() => {
    try {
      if (kind === 'buy') {
        return amountNumber >= 1000 ? createQuote('buy', amountNumber, selectedAsset) : null;
      } else if (kind === 'sell') {
        return createSellQuote(cryptoAmount, selectedAsset);
      } else {
        return createSwapQuote(swapSourceAmount, selectedAsset, targetAsset);
      }
    } catch {
      return null;
    }
  }, [kind, amountNumber, cryptoAmount, swapSourceAmount, selectedAsset, targetAsset]);

  // Address validation
  const addressValidation = useMemo(() => {
    if (kind === 'buy') {
      return receiveAddress.trim() ? validateCryptoAddress(receiveAddress, selectedAsset.network) : null;
    } else if (kind === 'swap') {
      return receiveAddress.trim() ? validateCryptoAddress(receiveAddress, targetAsset.network) : null;
    }
    return null;
  }, [kind, receiveAddress, selectedAsset, targetAsset]);

  useEffect(() => {
    quoteAttempt.current = null;
    idempotencyKey.current = null;
    setNotice(null);
    if (kind === 'swap' && selectedAsset.symbol === targetAsset.symbol) {
      setTargetAsset(ASSETS.find(a => a.symbol !== selectedAsset.symbol) || ASSETS[1]);
    }
  }, [kind, selectedAsset]);

  // Auto-load token & telegram auth
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadToken();
        if (saved && !cancelled) setToken(saved);
      } catch {}
      try { await fetch(`${API}/health`); } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!telegram.initData) return;
    void fetch(`${API}/v1/telegram/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: telegram.initData }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(async d => {
        await saveToken(d.accessToken);
        setToken(d.accessToken);
      })
      .catch(() => setNotice({ text: 'Telegram Auth error', type: 'error' }));
  }, [telegram.initData]);

  // Orders loading
  useEffect(() => {
    if (tab !== 'activity' || !token) return;
    void fetch(`${API}/v1/orders`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setOrders(d.items || []))
      .catch(() => setOrders([]));
  }, [tab, token]);

  // Account / KYC loading
  useEffect(() => {
    if (tab !== 'settings' || !token) return;
    void Promise.all([
      fetch(`${API}/v1/kyc`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/v1/me`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([k, m]) => {
        if (k.ok) {
          const d = await k.json();
          setKycStatus(d.cases?.[0]?.status || d.status || 'NOT_SUBMITTED');
        }
        if (m.ok) {
          const d = await m.json();
          setMfaEnabled(!!d.mfaEnabled);
        }
      })
      .catch(() => setKycStatus('NOT_CONFIGURED'));
  }, [tab, token]);

  async function submitOrder() {
    setBusy(true);
    setNotice(null);

    // Form pre-validation
    if (kind === 'buy') {
      if (!receiveAddress.trim()) {
        setNotice({ text: t.verifyAddressNotice, type: 'error' });
        setBusy(false);
        return;
      }
      if (addressValidation && !addressValidation.valid) {
        setNotice({ text: addressValidation.error || 'Adresse invalide', type: 'error' });
        setBusy(false);
        return;
      }
    } else if (kind === 'sell') {
      if (!payoutPhone.trim() || payoutPhone.length < 8) {
        setNotice({ text: 'Veuillez saisir un numéro Mobile Money valide.', type: 'error' });
        setBusy(false);
        return;
      }
    } else if (kind === 'swap') {
      if (!receiveAddress.trim()) {
        setNotice({ text: 'Veuillez renseigner votre adresse de réception cible.', type: 'error' });
        setBusy(false);
        return;
      }
      if (addressValidation && !addressValidation.valid) {
        setNotice({ text: addressValidation.error || 'Adresse cible invalide', type: 'error' });
        setBusy(false);
        return;
      }
    }

    try {
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // 1. Fetch server quote if needed
      const sameAttempt = quoteAttempt.current && Date.now() < Date.parse(quoteAttempt.current.expiresAt || '');
      let q = quoteAttempt.current;
      if (!sameAttempt) {
        const qres = await fetch(`${API}/v1/quotes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            kind,
            amount: kind === 'buy' ? amountNumber : undefined,
            cryptoAmount: kind === 'sell' ? cryptoAmount : kind === 'swap' ? swapSourceAmount : undefined,
            asset: selectedAsset.symbol,
            targetAsset: kind === 'swap' ? targetAsset.symbol : undefined,
            country: 'TG',
          }),
        });
        q = await qres.json();
        if (!qres.ok) throw new Error((q as { error?: string }).error || 'Devis indisponible');
        quoteAttempt.current = q;
      }

      // 2. Submit order with idempotency
      idempotencyKey.current ??= `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const response = await fetch(`${API}/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
          ...authHeaders,
        },
        body: JSON.stringify({
          kind,
          amount: kind === 'buy' ? amountNumber : 0,
          cryptoAmount: kind === 'sell' ? cryptoAmount : kind === 'swap' ? swapSourceAmount : undefined,
          asset: selectedAsset.symbol,
          targetAsset: kind === 'swap' ? targetAsset.symbol : undefined,
          paymentMethod: paymentMethod.id,
          payoutPhone: kind === 'sell' ? payoutPhone : undefined,
          payoutName: kind === 'sell' ? payoutName : undefined,
          address: (kind === 'buy' || kind === 'swap') ? receiveAddress.trim() : undefined,
          mode: 'demo',
          quoteId: q?.id,
          channel: telegram.inside ? 'telegram' : Platform.OS === 'web' ? 'web' : 'android',
        }),
      });

      const data = await response.json();
      if (response.status === 401) {
        setAuthRequired(true);
        throw new Error('Connectez-vous pour enregistrer cet ordre.');
      }
      if (!response.ok) throw new Error(data.error || 'Ordre impossible à créer');

      setOrders(current => [data, ...current]);
      idempotencyKey.current = null;
      quoteAttempt.current = null;
      setSelectedOrder(data);

      setNotice({
        text: `Ordre ${data.id.slice(0, 8)} créé avec succès en mode démonstration.`,
        type: 'success',
      });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Erreur de connexion', type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const filteredOrders = useMemo(() => {
    if (activityFilter === 'all') return orders;
    return orders.filter(o => o.kind === activityFilter);
  }, [orders, activityFilter]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.root}>
        {/* Topbar */}
        {!telegram.inside && (
          <View style={s.topbar}>
            <View style={s.brand}>
              <View style={s.logo}>
                <Text style={s.logoText}>A</Text>
              </View>
              <Text style={s.brandText}>{t.brand}</Text>
            </View>

            <View style={s.topRight}>
              <Text style={s.market}>{t.marketTogo}</Text>

              {/* Language Switcher */}
              <View style={s.langSwitch}>
                <Pressable
                  onPress={() => setLang('fr')}
                  style={[s.langButton, lang === 'fr' && s.langButtonActive]}
                >
                  <Text style={[s.langText, lang === 'fr' && s.langTextActive]}>FR</Text>
                </Pressable>
                <Pressable
                  onPress={() => setLang('en')}
                  style={[s.langButton, lang === 'en' && s.langButtonActive]}
                >
                  <Text style={[s.langText, lang === 'en' && s.langTextActive]}>EN</Text>
                </Pressable>
              </View>

              <Pressable onPress={() => setTab('settings')} style={s.avatar}>
                <Text style={s.avatarText}>{token ? '✓' : 'A'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={[s.shell, isWide && s.shellWide]}>
          {/* Desktop Sidebar */}
          {isWide && (
            <View style={s.sidebar}>
              <Text style={s.sideCaption}>{t.menu}</Text>
              {navItems.map(item => (
                <Pressable
                  key={item.tab}
                  onPress={() => setTab(item.tab)}
                  style={[s.sideLink, tab === item.tab && s.sideLinkActive]}
                >
                  <Ionicons
                    name={tab === item.tab ? item.activeIcon : item.icon}
                    size={20}
                    color={tab === item.tab ? C.green : C.muted}
                  />
                  <Text style={[s.sideText, tab === item.tab && s.sideTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}

              <View style={s.sideBottom}>
                <Text style={s.sideCaption}>NON-CUSTODIAL</Text>
                <Text style={s.sideNote}>Afribuild-Exchange transfère directement vos cryptos sur votre wallet externe.</Text>
              </View>
            </View>
          )}

          {/* Main Scroll Content */}
          <ScrollView
            style={s.content}
            contentContainerStyle={[s.contentInner, isWide && s.contentWide]}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.greeting}>
              <View>
                <Text style={s.eyebrow}>{t.brand} · {t.marketTogo}</Text>
                <Text style={s.title}>
                  {tab === 'home'
                    ? t.greetingTitle
                    : tab === 'trade'
                    ? 'Échanger'
                    : tab === 'activity'
                    ? t.activityTitle
                    : t.navSettings}
                </Text>
                <Text style={s.subtitle}>
                  {tab === 'home'
                    ? t.greetingSub
                    : tab === 'trade'
                    ? 'Achetez, vendez et convertissez vos cryptos instantanément.'
                    : tab === 'activity'
                    ? 'Historique et statut de vos opérations'
                    : 'Gérez votre profil, sécurité, assistance & préférences'}
                </Text>
              </View>
            </View>

            {/* TAB: ACCUEIL */}
            {tab === 'home' && (
              <>
                {/* Modern Revolut / FinTech Wallet Card */}
                <View style={s.hero}>
                  <View style={s.heroCopy}>
                    <View style={s.livePill}>
                      <View style={s.liveDot} />
                      <Text style={s.liveText}>PORTEFEUILLE ESTIMATIF · TOGO</Text>
                    </View>
                    <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFFFFF', marginTop: 12, letterSpacing: -0.5 }}>
                      250 000 <Text style={{ fontSize: 16, fontWeight: '700', color: C.lime }}>FCFA</Text>
                    </Text>
                    <Text style={{ fontSize: 11, color: '#C8E6D8', marginTop: 4 }}>
                      ≈ 0.00588 BTC · 385 USDT en cours
                    </Text>
                    <Pressable
                      style={s.primaryButton}
                      onPress={() => {
                        setKind('buy');
                        setTab('trade');
                      }}
                    >
                      <Text style={s.primaryButtonText}>{t.btnStart}</Text>
                      <Ionicons name="arrow-forward" size={18} color={C.limeDark} />
                    </Pressable>
                  </View>
                  <View style={s.heroArt}>
                    <View style={s.coinOuter}>
                      <View style={s.coinInner}>
                        <Text style={s.coinB}>₿</Text>
                      </View>
                    </View>
                    <Text style={s.sparkOne}>✦</Text>
                    <Text style={s.sparkTwo}>✧</Text>
                  </View>
                </View>

                {/* Quick Action Navigation Buttons */}
                <View style={s.quickActions}>
                  <Pressable
                    style={s.quickActionBtn}
                    onPress={() => {
                      setKind('buy');
                      setTab('trade');
                    }}
                  >
                    <View style={[s.quickActionIcon, { backgroundColor: C.greenLight }]}>
                      <Ionicons name="flash" size={18} color={C.green} />
                    </View>
                    <Text style={s.quickActionLabel}>{t.navBuy}</Text>
                  </Pressable>

                  <Pressable
                    style={s.quickActionBtn}
                    onPress={() => {
                      setKind('sell');
                      setTab('trade');
                    }}
                  >
                    <View style={[s.quickActionIcon, { backgroundColor: '#FEF3C7' }]}>
                      <Ionicons name="arrow-up-circle" size={18} color="#D97706" />
                    </View>
                    <Text style={s.quickActionLabel}>{t.navSell}</Text>
                  </Pressable>

                  <Pressable
                    style={s.quickActionBtn}
                    onPress={() => {
                      setKind('swap');
                      setTab('trade');
                    }}
                  >
                    <View style={[s.quickActionIcon, { backgroundColor: '#F3E8FF' }]}>
                      <Ionicons name="swap-horizontal" size={18} color="#7E22CE" />
                    </View>
                    <Text style={s.quickActionLabel}>{t.navSwap}</Text>
                  </Pressable>
                </View>

                {/* Live Market Assets Grid */}
                <View style={s.sectionHeader}>
                  <View>
                    <Text style={s.sectionTitle}>{t.todayMarket}</Text>
                    <Text style={s.sectionSub}>{t.indicativePrices}</Text>
                  </View>
                  <Text style={s.demoTag}>{t.indicativeTag}</Text>
                </View>

                <View style={s.marketGrid}>
                  {ASSETS.map(asset => (
                    <Pressable
                      key={asset.symbol}
                      style={s.assetCard}
                      onPress={() => {
                        setSelectedAsset(asset);
                        setKind('buy');
                        setTab('trade');
                      }}
                    >
                      <View style={s.assetTop}>
                        <View style={[s.assetIcon, { backgroundColor: `${asset.badgeColor}22` }]}>
                          <Text style={[s.assetGlyph, { color: asset.badgeColor }]}>{asset.glyph}</Text>
                        </View>
                        <View style={s.assetChange}>
                          <Ionicons name="arrow-up" size={13} color={C.green} />
                          <Text style={s.changeText}>+1,85%</Text>
                        </View>
                      </View>
                      <Text style={s.assetName}>{asset.name}</Text>
                      <Text style={s.assetPrice}>
                        {fmt(asset.priceXof)} <Text style={s.currency}>FCFA</Text>
                      </Text>
                      <Text style={s.assetSymbol}>{asset.symbol} · {asset.network}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Operations Selector Cards */}
                <View style={s.sectionHeader}>
                  <View>
                    <Text style={s.sectionTitle}>{t.chooseOperation}</Text>
                    <Text style={s.sectionSub}>{t.chooseOperationSub}</Text>
                  </View>
                </View>

                <View style={s.actionsGrid}>
                  <Pressable
                    style={s.actionCard}
                    onPress={() => {
                      setKind('buy');
                      setTab('trade');
                    }}
                  >
                    <View style={s.actionIcon}>
                      <Ionicons name="flash" size={22} color={C.green} />
                    </View>
                    <Text style={s.actionTitle}>{t.actionBuyTitle}</Text>
                    <Text style={s.actionDesc}>{t.actionBuyDesc}</Text>
                    <Ionicons style={s.actionArrow} name="arrow-forward" size={18} color={C.green} />
                  </Pressable>

                  <Pressable
                    style={s.actionCard}
                    onPress={() => {
                      setKind('sell');
                      setTab('trade');
                    }}
                  >
                    <View style={[s.actionIcon, { backgroundColor: '#FFF5EB' }]}>
                      <Ionicons name="arrow-up-circle" size={22} color="#C26A18" />
                    </View>
                    <Text style={s.actionTitle}>{t.actionSellTitle}</Text>
                    <Text style={s.actionDesc}>{t.actionSellDesc}</Text>
                    <Ionicons style={s.actionArrow} name="arrow-forward" size={18} color="#C26A18" />
                  </Pressable>

                  <Pressable
                    style={s.actionCard}
                    onPress={() => {
                      setKind('swap');
                      setTab('trade');
                    }}
                  >
                    <View style={[s.actionIcon, { backgroundColor: '#F3E8FF' }]}>
                      <Ionicons name="swap-horizontal" size={22} color="#7E22CE" />
                    </View>
                    <Text style={s.actionTitle}>{t.actionSwapTitle}</Text>
                    <Text style={s.actionDesc}>{t.actionSwapDesc}</Text>
                    <Ionicons style={s.actionArrow} name="arrow-forward" size={18} color="#7E22CE" />
                  </Pressable>
                </View>
              </>
            )}

            {/* TAB: ÉCHANGER (Modern Double-Card Trading Desk) */}
            {tab === 'trade' && (
              <View style={s.tradeContainer}>
                {/* Segmented Controller [ Acheter | Vendre | Swap ] */}
                <View style={s.tradeSegment}>
                  <Pressable
                    onPress={() => setKind('buy')}
                    style={[s.tradeSegmentBtn, kind === 'buy' && s.tradeSegmentBtnActive]}
                  >
                    <Ionicons name="flash" size={14} color={kind === 'buy' ? C.greenDark : C.muted} />
                    <Text style={[s.tradeSegmentText, kind === 'buy' && s.tradeSegmentTextActive]}>
                      {t.navBuy}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setKind('sell')}
                    style={[s.tradeSegmentBtn, kind === 'sell' && s.tradeSegmentBtnActive]}
                  >
                    <Ionicons name="arrow-up-circle" size={14} color={kind === 'sell' ? C.greenDark : C.muted} />
                    <Text style={[s.tradeSegmentText, kind === 'sell' && s.tradeSegmentTextActive]}>
                      {t.navSell}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setKind('swap')}
                    style={[s.tradeSegmentBtn, kind === 'swap' && s.tradeSegmentBtnActive]}
                  >
                    <Ionicons name="swap-horizontal" size={14} color={kind === 'swap' ? C.greenDark : C.muted} />
                    <Text style={[s.tradeSegmentText, kind === 'swap' && s.tradeSegmentTextActive]}>
                      {t.navSwap}
                    </Text>
                  </Pressable>
                </View>

                {/* Main FinTech Exchange Card */}
                <View style={s.tradeCard}>
                  {/* 1. PAY / SEND BLOCK */}
                  <View style={s.swapBox}>
                    <View style={s.swapBoxHeader}>
                      <Text style={s.swapBoxLabel}>
                        {kind === 'buy' ? 'Vous payez' : kind === 'sell' ? 'Vous vendez' : 'Vous échangez'}
                      </Text>
                      <Text style={s.swapBoxBalance}>
                        {kind === 'buy' ? 'Paiement Mobile' : `Réseau ${selectedAsset.network}`}
                      </Text>
                    </View>

                    <View style={s.swapBoxRow}>
                      {kind === 'buy' ? (
                        <TextInput
                          value={amountFiat}
                          onChangeText={v => {
                            setAmountFiat(v);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          keyboardType="number-pad"
                          style={s.swapAmountInput}
                          placeholder="25 000"
                          placeholderTextColor={C.mutedLight}
                        />
                      ) : kind === 'sell' ? (
                        <TextInput
                          value={cryptoAmount}
                          onChangeText={v => {
                            setCryptoAmount(v);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          keyboardType="decimal-pad"
                          style={s.swapAmountInput}
                          placeholder="0.001"
                          placeholderTextColor={C.mutedLight}
                        />
                      ) : (
                        <TextInput
                          value={swapSourceAmount}
                          onChangeText={v => {
                            setSwapSourceAmount(v);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          keyboardType="decimal-pad"
                          style={s.swapAmountInput}
                          placeholder="0.001"
                          placeholderTextColor={C.mutedLight}
                        />
                      )}

                      {/* Asset / Currency Pill */}
                      {kind === 'buy' ? (
                        <View style={s.swapAssetPill}>
                          <Text style={s.swapAssetSymbol}>XOF</Text>
                          <Text style={{ fontSize: 10, color: C.muted, fontWeight: '700' }}>FCFA</Text>
                        </View>
                      ) : (
                        <Pressable onPress={() => setAssetPickerTarget('source')} style={s.swapAssetPill}>
                          <Text style={[s.swapAssetGlyph, { color: selectedAsset.badgeColor || C.green }]}>
                            {selectedAsset.glyph}
                          </Text>
                          <Text style={s.swapAssetSymbol}>{selectedAsset.symbol}</Text>
                          <Ionicons name="chevron-down" size={14} color={C.muted} />
                        </Pressable>
                      )}
                    </View>

                    {/* Quick amounts row for fiat buy */}
                    {kind === 'buy' && (
                      <View style={s.quickAmounts}>
                        {[10000, 25000, 50000, 100000].map(v => (
                          <Pressable
                            key={v}
                            onPress={() => {
                              setAmountFiat(String(v));
                              quoteAttempt.current = null;
                              idempotencyKey.current = null;
                            }}
                            style={[s.quickChip, Number(amountFiat) === v && s.quickChipSelected]}
                          >
                            <Text style={[s.quickText, Number(amountFiat) === v && s.quickTextSelected]}>
                              {fmt(v)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Centered Floating Swap Arrow Button */}
                  <View style={s.swapDivider}>
                    <Pressable
                      onPress={() => {
                        if (kind === 'swap') {
                          const temp = selectedAsset;
                          setSelectedAsset(targetAsset);
                          setTargetAsset(temp);
                        } else if (kind === 'buy') {
                          setKind('sell');
                        } else {
                          setKind('buy');
                        }
                      }}
                      style={s.swapCircleBtn}
                    >
                      <Ionicons
                        name={kind === 'swap' ? 'swap-vertical' : 'arrow-down'}
                        size={16}
                        color={C.green}
                      />
                    </Pressable>
                  </View>

                  {/* 2. RECEIVE / DESTINATION BLOCK */}
                  <View style={s.swapBox}>
                    <View style={s.swapBoxHeader}>
                      <Text style={s.swapBoxLabel}>
                        {kind === 'buy' ? 'Vous recevez (estimé)' : kind === 'sell' ? 'Vous recevez (net)' : 'Vous recevez (estimé)'}
                      </Text>
                      <Text style={s.swapBoxBalance}>
                        {kind === 'sell' ? 'Mobile Money' : `Réseau ${kind === 'swap' ? targetAsset.network : selectedAsset.network}`}
                      </Text>
                    </View>

                    <View style={s.swapBoxRow}>
                      <Text style={s.swapAmountInput} numberOfLines={1}>
                        {kind === 'buy' && liveQuote
                          ? `${liveQuote.estimatedAsset.toFixed(selectedAsset.decimals > 8 ? 6 : selectedAsset.decimals)}`
                          : kind === 'sell' && liveQuote
                          ? `${fmt(liveQuote.estimatedFiat || 0)}`
                          : kind === 'swap' && liveQuote
                          ? `${liveQuote.estimatedAsset.toFixed(targetAsset.decimals > 8 ? 6 : targetAsset.decimals)}`
                          : '0.00'}
                      </Text>

                      {/* Receive Asset Pill */}
                      {kind === 'sell' ? (
                        <View style={s.swapAssetPill}>
                          <Text style={s.swapAssetSymbol}>XOF</Text>
                          <Text style={{ fontSize: 10, color: C.muted, fontWeight: '700' }}>FCFA</Text>
                        </View>
                      ) : kind === 'buy' ? (
                        <Pressable onPress={() => setAssetPickerTarget('source')} style={s.swapAssetPill}>
                          <Text style={[s.swapAssetGlyph, { color: selectedAsset.badgeColor || C.green }]}>
                            {selectedAsset.glyph}
                          </Text>
                          <Text style={s.swapAssetSymbol}>{selectedAsset.symbol}</Text>
                          <Ionicons name="chevron-down" size={14} color={C.muted} />
                        </Pressable>
                      ) : (
                        <Pressable onPress={() => setAssetPickerTarget('target')} style={s.swapAssetPill}>
                          <Text style={[s.swapAssetGlyph, { color: targetAsset.badgeColor || C.green }]}>
                            {targetAsset.glyph}
                          </Text>
                          <Text style={s.swapAssetSymbol}>{targetAsset.symbol}</Text>
                          <Ionicons name="chevron-down" size={14} color={C.muted} />
                        </Pressable>
                      )}
                    </View>
                  </View>

                  {/* 3. PAYMENT & RECIPIENT SETTINGS */}
                  <View style={{ marginTop: 14 }}>
                    {/* Payment Method Pills (Buy & Sell) */}
                    {(kind === 'buy' || kind === 'sell') && (
                      <View style={{ marginBottom: 12 }}>
                        <Text style={s.selectorLabel}>
                          {kind === 'buy' ? 'Moyen de paiement' : 'Réception Mobile Money'}
                        </Text>
                        <View style={s.chipGroup}>
                          {PAYMENT_METHODS.map(method => (
                            <Pressable
                              key={method.id}
                              onPress={() => setPaymentMethod(method)}
                              style={[s.chip, paymentMethod.id === method.id && s.chipSelected]}
                            >
                              <View style={[s.chipBadge, { backgroundColor: method.badgeColor }]} />
                              <Text style={[s.chipText, paymentMethod.id === method.id && s.chipTextSelected]}>
                                {method.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Receive Crypto Address (Buy & Swap) */}
                    {(kind === 'buy' || kind === 'swap') && (
                      <View>
                        <Text style={s.selectorLabel}>
                          {kind === 'buy'
                            ? `Adresse de réception (${selectedAsset.symbol} · ${selectedAsset.network})`
                            : `Adresse de réception (${targetAsset.symbol} · ${targetAsset.network})`}
                        </Text>
                        <TextInput
                          value={receiveAddress}
                          onChangeText={v => {
                            setReceiveAddress(v);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          autoCapitalize="none"
                          placeholder={`Collez votre adresse ${kind === 'swap' ? targetAsset.symbol : selectedAsset.symbol}`}
                          placeholderTextColor={C.muted}
                          style={s.addressInput}
                        />
                        {addressValidation && (
                          <Text
                            style={{
                              fontSize: 10,
                              color: addressValidation.valid ? C.green : C.danger,
                              marginTop: 4,
                              fontWeight: '600',
                            }}
                          >
                            {addressValidation.valid ? '✓ Adresse syntaxiquement valide' : addressValidation.error}
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Mobile Money Coordinates (Sell) */}
                    {kind === 'sell' && (
                      <View style={{ gap: 8 }}>
                        <View>
                          <Text style={s.selectorLabel}>Numéro Mobile Money (+228...)</Text>
                          <TextInput
                            value={payoutPhone}
                            onChangeText={setPayoutPhone}
                            keyboardType="phone-pad"
                            placeholder="+228 90 00 00 00"
                            placeholderTextColor={C.muted}
                            style={s.addressInput}
                          />
                        </View>
                        <View>
                          <Text style={s.selectorLabel}>Nom du titulaire du compte</Text>
                          <TextInput
                            value={payoutName}
                            onChangeText={setPayoutName}
                            placeholder="Ex: Jean Koffi"
                            placeholderTextColor={C.muted}
                            style={s.addressInput}
                          />
                        </View>
                      </View>
                    )}
                  </View>

                  {/* 4. TRANSPARENT SUMMARY */}
                  <View style={s.tradeSummaryCard}>
                    <View style={s.tradeSummaryRow}>
                      <Text style={s.tradeSummaryLabel}>Taux de conversion</Text>
                      <Text style={s.tradeSummaryValue}>
                        {kind === 'swap'
                          ? `1 ${selectedAsset.symbol} ≈ ${liveQuote?.indicativeRate ? liveQuote.indicativeRate.toFixed(4) : '?'} ${targetAsset.symbol}`
                          : `1 ${selectedAsset.symbol} = ${fmt(selectedAsset.priceXof)} XOF`}
                      </Text>
                    </View>

                    <View style={s.tradeSummaryRow}>
                      <Text style={s.tradeSummaryLabel}>Frais de service & réseau</Text>
                      <Text style={s.tradeSummaryHighlight}>
                        {liveQuote ? `${fmt(liveQuote.feeFiat)} XOF (Inclus)` : 'Inclus'}
                      </Text>
                    </View>

                    <View style={s.tradeSummaryRow}>
                      <Text style={s.tradeSummaryLabel}>Délai estimé</Text>
                      <Text style={s.tradeSummaryValue}>~ 2 à 5 minutes</Text>
                    </View>
                  </View>

                  {/* 5. MAIN ACTION BUTTON */}
                  <Pressable
                    onPress={submitOrder}
                    disabled={busy || !liveQuote}
                    style={[s.primaryButton, s.quoteButton, (busy || !liveQuote) && { opacity: 0.7 }]}
                  >
                    {busy ? (
                      <ActivityIndicator color={C.limeDark} />
                    ) : (
                      <>
                        <Text style={s.primaryButtonText}>
                          {kind === 'buy' ? 'Acheter maintenant' : kind === 'sell' ? 'Vendre maintenant' : 'Confirmer le swap'}
                        </Text>
                        <Ionicons name="arrow-forward" size={18} color={C.limeDark} />
                      </>
                    )}
                  </Pressable>

                  <Text style={s.disclaimer}>{t.disclaimerDemo}</Text>

                  {!!notice && (
                    <Text
                      style={[
                        s.notice,
                        notice.type === 'error' && { color: C.danger },
                        notice.type === 'info' && { color: C.blue },
                      ]}
                    >
                      {notice.text}
                    </Text>
                  )}

                  {authRequired && !token && (
                    <View style={{ marginTop: 12 }}>
                      <AuthPanel
                        onAuthenticated={tkn => {
                          setToken(tkn);
                          setAuthRequired(false);
                        }}
                      />
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* TAB: ACTIVITÉ (Pure Transaction List - No intrusive auth form) */}
            {tab === 'activity' && (
              <>
                {/* Filter Chips */}
                <View style={s.filterRow}>
                  {(['all', 'buy', 'sell', 'swap'] as const).map(f => (
                    <Pressable
                      key={f}
                      onPress={() => setActivityFilter(f)}
                      style={[s.filterChip, activityFilter === f && s.filterChipActive]}
                    >
                      <Text style={[s.filterText, activityFilter === f && s.filterTextActive]}>
                        {f === 'all' ? 'Toutes' : f.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {filteredOrders.length > 0 ? (
                  filteredOrders.map((o, idx) => (
                    <Pressable
                      key={String(o.id || idx)}
                      onPress={() => setSelectedOrder(o)}
                      style={s.orderCard}
                    >
                      <View style={s.orderTop}>
                        <Text style={s.orderIdText}>ID: {String(o.id || '').slice(0, 12)}</Text>
                        <View
                          style={[
                            s.statusBadge,
                            {
                              backgroundColor:
                                o.status === 'SETTLED' ? C.greenLight : '#FEF3C7',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              s.statusText,
                              { color: o.status === 'SETTLED' ? C.green : '#B45309' },
                            ]}
                          >
                            {String(o.status || 'DRAFT')}
                          </Text>
                        </View>
                      </View>
                      <View style={s.orderBody}>
                        <View>
                          <Text style={s.orderAsset}>
                            {String(o.kind || 'Ordre').toUpperCase()} · {String(o.crypto_asset || o.asset || 'BTC')}
                            {o.target_asset ? ` → ${o.target_asset}` : ''}
                          </Text>
                          <Text style={s.orderAmount}>
                            {o.crypto_amount ? `${o.crypto_amount} ${o.crypto_asset || ''}` : 'Montant estimé'}
                          </Text>
                        </View>
                        <View>
                          <Text style={s.orderFiat}>
                            {o.fiat_amount ? `${fmt(Number(o.fiat_amount))} XOF` : '—'}
                          </Text>
                          <Text style={s.orderDate}>
                            {String(o.created_at || o.createdAt || 'Récent').slice(0, 16)}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <View style={s.emptyCard}>
                    <View style={s.emptyIcon}>
                      <Ionicons name="receipt-outline" size={28} color={C.green} />
                    </View>
                    <Text style={s.emptyTitle}>{t.activityEmptyTitle}</Text>
                    <Text style={s.emptyDesc}>{t.activityEmptyDesc}</Text>
                    <Pressable
                      onPress={() => {
                        setKind('buy');
                        setTab('trade');
                      }}
                      style={s.secondaryButton}
                    >
                      <Text style={s.secondaryButtonText}>{t.btnCreateOrderDemo}</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            {/* TAB: PARAMÈTRES (Revolut / Apple Style Clean Grouped Settings) */}
            {tab === 'settings' && (
              <View style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
                {/* 1. Profile Hero Card */}
                <View style={s.settingsProfileCard}>
                  <View style={s.settingsAvatar}>
                    <Text style={s.settingsAvatarText}>{token ? '✓' : 'A'}</Text>
                  </View>
                  <View style={s.settingsProfileInfo}>
                    <Text style={s.settingsProfileName}>
                      {token ? 'Utilisateur Afribuild' : 'Session Démonstration'}
                    </Text>
                    <Text style={s.settingsProfileSub}>
                      {token ? 'Compte actif · Session vérifiée' : 'Mode démonstration'}
                    </Text>
                  </View>
                  {token ? (
                    <Pressable
                      onPress={async () => {
                        try {
                          await fetch(`${API}/v1/auth/logout`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                          });
                        } finally {
                          await saveToken(null);
                          setToken(null);
                        }
                      }}
                      style={[s.settingsProfileBadge, { backgroundColor: '#FEE2E2' }]}
                    >
                      <Text style={[s.settingsProfileBadgeText, { color: C.danger }]}>Déconnexion</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => setExpandedSetting(expandedSetting === 'auth' ? null : 'auth')}
                      style={[s.settingsProfileBadge, { backgroundColor: C.greenLight }]}
                    >
                      <Text style={[s.settingsProfileBadgeText, { color: C.green }]}>
                        {expandedSetting === 'auth' ? 'Fermer' : 'Connexion'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {/* Collapsible Quick Auth Drawer */}
                {expandedSetting === 'auth' && !token && (
                  <View style={{ marginBottom: 18 }}>
                    <AuthPanel
                      onAuthenticated={tkn => {
                        setToken(tkn);
                        setExpandedSetting(null);
                      }}
                    />
                  </View>
                )}

                {/* 2. Group: Sécurité & Vérification */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Sécurité & Conformité</Text>
                  <View style={s.settingsCard}>
                    {/* Row KYC */}
                    <Pressable
                      onPress={() => setExpandedSetting(expandedSetting === 'kyc' ? null : 'kyc')}
                      style={s.settingsRow}
                    >
                      <View style={[s.settingsIconBox, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name="card-outline" size={17} color="#D97706" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Vérification d’identité (KYC)</Text>
                        <Text style={s.settingsRowDesc}>Niveau 1 standard · Plafond 5 000 000 XOF</Text>
                      </View>
                      <View style={s.settingsRowRight}>
                        <View
                          style={[
                            s.settingsTagPill,
                            {
                              backgroundColor:
                                kycStatus === 'VERIFIED'
                                  ? C.greenLight
                                  : kycStatus === 'PENDING'
                                  ? '#FEF3C7'
                                  : '#F1F5F9',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              s.settingsTagText,
                              {
                                color:
                                  kycStatus === 'VERIFIED'
                                    ? C.green
                                    : kycStatus === 'PENDING'
                                    ? '#D97706'
                                    : C.muted,
                              },
                            ]}
                          >
                            {kycStatus === 'VERIFIED' ? 'Vérifié' : kycStatus === 'PENDING' ? 'En attente' : 'Standard'}
                          </Text>
                        </View>
                        <Ionicons
                          name={expandedSetting === 'kyc' ? 'chevron-up' : 'chevron-forward'}
                          size={16}
                          color={C.mutedLight}
                        />
                      </View>
                    </Pressable>

                    {/* Drawer KYC */}
                    {expandedSetting === 'kyc' && (
                      <View style={s.settingsDrawer}>
                        <Text style={s.settingsDrawerTitle}>Statut de conformité réglementaire</Text>
                        <Text style={s.settingsDrawerText}>
                          La vérification Niveau 1 permet d'effectuer des achats, ventes et retraits jusqu'à 5 000 000 XOF/jour dans l'ensemble de la zone UEMOA.
                        </Text>
                        {token ? (
                          <Pressable
                            disabled={kycBusy}
                            onPress={async () => {
                              setKycBusy(true);
                              try {
                                const r = await fetch(`${API}/v1/kyc`, {
                                  method: 'POST',
                                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ country: 'TG' }),
                                });
                                const d = await r.json();
                                setKycStatus(d.status || d.error || 'PENDING');
                              } catch {
                                setKycStatus('Erreur');
                              } finally {
                                setKycBusy(false);
                              }
                            }}
                            style={[s.primaryButton, { alignSelf: 'flex-start', minHeight: 40, marginTop: 4 }]}
                          >
                            {kycBusy ? (
                              <ActivityIndicator size="small" color={C.limeDark} />
                            ) : (
                              <Text style={s.primaryButtonText}>{t.btnRequestKyc}</Text>
                            )}
                          </Pressable>
                        ) : (
                          <Pressable
                            onPress={() => setExpandedSetting('auth')}
                            style={[s.secondaryButton, { alignSelf: 'flex-start', marginTop: 4 }]}
                          >
                            <Text style={s.secondaryButtonText}>Se connecter pour vérifier</Text>
                          </Pressable>
                        )}
                      </View>
                    )}

                    {/* Row 2FA */}
                    <Pressable
                      onPress={() => setExpandedSetting(expandedSetting === 'mfa' ? null : 'mfa')}
                      style={[s.settingsRow, s.settingsRowLast]}
                    >
                      <View style={[s.settingsIconBox, { backgroundColor: C.greenLight }]}>
                        <Ionicons name="lock-closed-outline" size={17} color={C.green} />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Authentification 2FA (TOTP)</Text>
                        <Text style={s.settingsRowDesc}>Protection Google Authenticator</Text>
                      </View>
                      <View style={s.settingsRowRight}>
                        <View
                          style={[
                            s.settingsTagPill,
                            { backgroundColor: mfaEnabled ? C.greenLight : '#F1F5F9' },
                          ]}
                        >
                          <Text
                            style={[
                              s.settingsTagText,
                              { color: mfaEnabled ? C.green : C.muted },
                            ]}
                          >
                            {mfaEnabled ? 'Activée' : 'Désactivée'}
                          </Text>
                        </View>
                        <Ionicons
                          name={expandedSetting === 'mfa' ? 'chevron-up' : 'chevron-forward'}
                          size={16}
                          color={C.mutedLight}
                        />
                      </View>
                    </Pressable>

                    {/* Drawer 2FA */}
                    {expandedSetting === 'mfa' && (
                      <View style={s.settingsDrawer}>
                        {mfaEnabled ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Ionicons name="checkmark-circle" size={20} color={C.green} />
                            <Text style={{ fontSize: 12, fontWeight: '700', color: C.green }}>
                              Double authentification active et sécurisée
                            </Text>
                          </View>
                        ) : token ? (
                          <View>
                            <Text style={s.settingsDrawerText}>
                              Protégez vos ordres et retraits avec un code généré par votre application d'authentification.
                            </Text>
                            {!mfaSecret ? (
                              <Pressable
                                disabled={mfaBusy}
                                onPress={async () => {
                                  setMfaBusy(true);
                                  setMfaNotice('');
                                  try {
                                    const r = await fetch(`${API}/v1/me/mfa/enroll`, {
                                      method: 'POST',
                                      headers: { Authorization: `Bearer ${token}` },
                                    });
                                    const d = await r.json();
                                    if (!r.ok) throw new Error(d.error);
                                    setMfaSecret(d.secret);
                                  } catch (e) {
                                    setMfaNotice(e instanceof Error ? e.message : 'Enrôlement impossible');
                                  } finally {
                                    setMfaBusy(false);
                                  }
                                }}
                                style={[s.primaryButton, { alignSelf: 'flex-start', minHeight: 40, marginTop: 4 }]}
                              >
                                {mfaBusy ? (
                                  <ActivityIndicator size="small" color={C.limeDark} />
                                ) : (
                                  <Text style={s.primaryButtonText}>{t.btnSetupMfa}</Text>
                                )}
                              </Pressable>
                            ) : (
                              <View style={{ marginTop: 6 }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: C.ink }}>
                                  Secret Google Authenticator :
                                </Text>
                                <Text selectable style={s.mfaSecret}>
                                  {mfaSecret}
                                </Text>
                                <TextInput
                                  value={mfaCode}
                                  onChangeText={v => setMfaCode(v.replace(/\D/g, '').slice(0, 6))}
                                  keyboardType="number-pad"
                                  placeholder={t.mfaInputCode}
                                  placeholderTextColor={C.muted}
                                  style={s.authInput}
                                />
                                <Pressable
                                  disabled={mfaBusy || mfaCode.length < 6}
                                  onPress={async () => {
                                    setMfaBusy(true);
                                    setMfaNotice('');
                                    try {
                                      const r = await fetch(`${API}/v1/me/mfa/confirm`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                        body: JSON.stringify({ code: mfaCode }),
                                      });
                                      const d = await r.json();
                                      if (!r.ok) throw new Error(d.error);
                                      setMfaEnabled(true);
                                      setMfaSecret('');
                                      setExpandedSetting(null);
                                    } catch (e) {
                                      setMfaNotice(e instanceof Error ? e.message : 'Code incorrect');
                                    } finally {
                                      setMfaBusy(false);
                                    }
                                  }}
                                  style={[s.primaryButton, { alignSelf: 'flex-start', minHeight: 40, marginTop: 8 }]}
                                >
                                  <Text style={s.primaryButtonText}>{t.btnConfirmMfa}</Text>
                                </Pressable>
                              </View>
                            )}
                            {!!mfaNotice && <Text style={s.notice}>{mfaNotice}</Text>}
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => setExpandedSetting('auth')}
                            style={[s.secondaryButton, { alignSelf: 'flex-start', marginTop: 4 }]}
                          >
                            <Text style={s.secondaryButtonText}>Se connecter pour configurer</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                </View>

                {/* 3. Group: Préférences & Région */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Préférences & Région</Text>
                  <View style={s.settingsCard}>
                    {/* Row Language */}
                    <View style={s.settingsRow}>
                      <View style={[s.settingsIconBox, { backgroundColor: '#F3E8FF' }]}>
                        <Ionicons name="language-outline" size={17} color="#7E22CE" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>{t.language}</Text>
                        <Text style={s.settingsRowDesc}>Langue de l'interface utilisateur</Text>
                      </View>
                      <View style={s.langSwitch}>
                        <Pressable
                          onPress={() => setLang('fr')}
                          style={[s.langButton, lang === 'fr' && s.langButtonActive]}
                        >
                          <Text style={[s.langText, lang === 'fr' && s.langTextActive]}>FR</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setLang('en')}
                          style={[s.langButton, lang === 'en' && s.langButtonActive]}
                        >
                          <Text style={[s.langText, lang === 'en' && s.langTextActive]}>EN</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Row Market */}
                    <View style={[s.settingsRow, s.settingsRowLast]}>
                      <View style={[s.settingsIconBox, { backgroundColor: '#EFF6FF' }]}>
                        <Ionicons name="globe-outline" size={17} color="#2563EB" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Zone Monétaire & Marché</Text>
                        <Text style={s.settingsRowDesc}>UEMOA · Franc CFA (XOF)</Text>
                      </View>
                      <View style={s.settingsRowRight}>
                        <Text style={s.settingsRowValue}>Togo (TG)</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* 4. Group: Support & Équipe */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Assistance & Opérations</Text>
                  <View style={s.settingsCard}>
                    {/* Row Support */}
                    <Pressable
                      onPress={() => setExpandedSetting(expandedSetting === 'support' ? null : 'support')}
                      style={s.settingsRow}
                    >
                      <View style={[s.settingsIconBox, { backgroundColor: '#CCFBF1' }]}>
                        <Ionicons name="chatbubbles-outline" size={17} color="#0D9488" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Centre d’assistance SLA 24/7</Text>
                        <Text style={s.settingsRowDesc}>Posez une question ou signalez un litige</Text>
                      </View>
                      <View style={s.settingsRowRight}>
                        <Text style={[s.settingsRowValue, { color: '#0D9488' }]}>Ouvrir</Text>
                        <Ionicons
                          name={expandedSetting === 'support' ? 'chevron-up' : 'chevron-forward'}
                          size={16}
                          color={C.mutedLight}
                        />
                      </View>
                    </Pressable>

                    {/* Drawer Support */}
                    {expandedSetting === 'support' && (
                      <View style={s.settingsDrawer}>
                        <Text style={s.settingsDrawerTitle}>{t.supportCategory}</Text>
                        <View style={s.chipGroup}>
                          {[
                            { id: 'GENERAL', label: t.supportCategoryGeneral },
                            { id: 'PAYMENT', label: t.supportCategoryPayment },
                            { id: 'BLOCKCHAIN', label: t.supportCategoryBlockchain },
                            { id: 'KYC', label: t.supportCategoryKyc },
                          ].map(cat => (
                            <Pressable
                              key={cat.id}
                              onPress={() => setTicketCategory(cat.id)}
                              style={[s.chip, ticketCategory === cat.id && s.chipSelected]}
                            >
                              <Text style={[s.chipText, ticketCategory === cat.id && s.chipTextSelected]}>
                                {cat.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>

                        <TextInput
                          value={ticketMessage}
                          onChangeText={setTicketMessage}
                          multiline
                          placeholder={t.supportMessagePlaceholder}
                          placeholderTextColor={C.muted}
                          style={s.supportInput}
                        />

                        <Pressable
                          disabled={ticketBusy || !ticketMessage.trim()}
                          onPress={async () => {
                            if (!token) {
                              setTicketNotice('Connectez-vous pour envoyer votre demande au support.');
                              return;
                            }
                            setTicketBusy(true);
                            setTicketNotice('');
                            try {
                              const r = await fetch(`${API}/v1/support/tickets`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ category: ticketCategory, message: ticketMessage }),
                              });
                              const d = await r.json();
                              if (!r.ok) throw new Error(d.error);
                              setTicketMessage('');
                              setTicketNotice(`${t.ticketCreatedNotice} ${d.id}`);
                            } catch (e) {
                              setTicketNotice(e instanceof Error ? e.message : 'Erreur d’envoi');
                            } finally {
                              setTicketBusy(false);
                            }
                          }}
                          style={[s.primaryButton, { alignSelf: 'flex-start', minHeight: 42, marginTop: 8 }]}
                        >
                          {ticketBusy ? (
                            <ActivityIndicator size="small" color={C.limeDark} />
                          ) : (
                            <>
                              <Text style={s.primaryButtonText}>{t.btnCreateTicket}</Text>
                              <Ionicons name="arrow-forward" size={16} color={C.limeDark} />
                            </>
                          )}
                        </Pressable>

                        {!!ticketNotice && <Text style={s.notice}>{ticketNotice}</Text>}
                      </View>
                    )}

                    {/* Row Admin Portal */}
                    <Pressable
                      onPress={() => router.push('/admin')}
                      style={[s.settingsRow, s.settingsRowLast]}
                    >
                      <View style={[s.settingsIconBox, { backgroundColor: '#F0F9F5' }]}>
                        <Ionicons name="shield-checkmark-outline" size={17} color={C.green} />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>{t.teamPortalLink}</Text>
                        <Text style={s.settingsRowDesc}>Supervision, réconciliation, ordres & audit</Text>
                      </View>
                      <View style={s.settingsRowRight}>
                        <View style={[s.settingsTagPill, { backgroundColor: C.greenLight }]}>
                          <Text style={[s.settingsTagText, { color: C.green }]}>Admin</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={C.mutedLight} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                {/* 5. Group: Application */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Application</Text>
                  <View style={s.settingsCard}>
                    <View style={[s.settingsRow, s.settingsRowLast]}>
                      <View style={[s.settingsIconBox, { backgroundColor: '#F1F5F9' }]}>
                        <Ionicons name="information-circle-outline" size={17} color="#64748B" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Afribuild-Exchange</Text>
                        <Text style={s.settingsRowDesc}>Comptoir digital non-custodial UEMOA</Text>
                      </View>
                      <Text style={s.settingsRowValue}>v1.2.0</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* Footer */}
            <View style={s.footer}>
              <Text style={s.footerText}>Afribuild-Exchange · Comptoir crypto non-custodial</Text>

              <View style={s.footerLinks}>
                <Pressable onPress={() => setTab('settings')}>
                  <Text style={s.footerLink}>{t.navSettings}</Text>
                </Pressable>
                <Pressable onPress={() => router.push('/admin')}>
                  <Text style={s.footerLink}>{t.navAdmin}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>

        {/* Fixed Mobile Bottom Navigation Dock */}
        {!isWide && (
          <View style={[s.bottomNav, telegram.inside && s.tgBottomNav]}>
            {navItems.map(item => (
              <Pressable
                key={item.tab}
                onPress={() => setTab(item.tab)}
                style={[s.navItem, tab === item.tab && s.navItemActive]}
              >
                <Ionicons
                  name={tab === item.tab ? item.activeIcon : item.icon}
                  size={20}
                  color={tab === item.tab ? C.green : C.muted}
                />
                <Text style={[s.navLabel, tab === item.tab && s.navLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* MODAL: ASSET PICKER */}
        {!!assetPickerTarget && (
          <Modal transparent animationType="fade" visible={!!assetPickerTarget}>
            <View style={s.modalOverlay}>
              <View style={s.modalSheet}>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle}>
                    {assetPickerTarget === 'source' ? 'Choisir la crypto' : 'Choisir la crypto de destination'}
                  </Text>
                  <Pressable onPress={() => setAssetPickerTarget(null)}>
                    <Ionicons name="close-circle-outline" size={26} color={C.muted} />
                  </Pressable>
                </View>

                {ASSETS.map(asset => {
                  const isCurrent =
                    (assetPickerTarget === 'source' ? selectedAsset.symbol : targetAsset.symbol) === asset.symbol;
                  return (
                    <Pressable
                      key={asset.symbol}
                      onPress={() => {
                        if (assetPickerTarget === 'source') {
                          setSelectedAsset(asset);
                        } else {
                          setTargetAsset(asset);
                        }
                        setAssetPickerTarget(null);
                        quoteAttempt.current = null;
                        idempotencyKey.current = null;
                      }}
                      style={[
                        s.settingsRow,
                        {
                          paddingVertical: 12,
                          backgroundColor: isCurrent ? C.greenLight : '#FFFFFF',
                          borderRadius: 12,
                          marginBottom: 6,
                          borderBottomWidth: 0,
                        },
                      ]}
                    >
                      <View style={[s.settingsIconBox, { backgroundColor: `${asset.badgeColor}22` }]}>
                        <Text style={[s.swapAssetGlyph, { color: asset.badgeColor }]}>{asset.glyph}</Text>
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>{asset.name}</Text>
                        <Text style={s.settingsRowDesc}>{asset.symbol} · Réseau {asset.network}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: C.ink }}>
                        {fmt(asset.priceXof)} XOF
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Modal>
        )}

        {/* Order Details & Receipt Modal */}
        {selectedOrder && (
          <Modal transparent animationType="fade" visible={!!selectedOrder}>
            <View style={s.modalOverlay}>
              <View style={s.modalSheet}>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle}>{t.orderReceipt}</Text>
                  <Pressable onPress={() => setSelectedOrder(null)}>
                    <Ionicons name="close-circle-outline" size={26} color={C.muted} />
                  </Pressable>
                </View>

                <View style={s.quoteDivider} />
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>{t.orderId}</Text>
                  <Text style={s.quoteValue}>{String(selectedOrder.id)}</Text>
                </View>
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>{t.orderType}</Text>
                  <Text style={s.quoteValue}>{String(selectedOrder.kind).toUpperCase()}</Text>
                </View>
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>{t.orderStatus}</Text>
                  <Text style={[s.quoteValue, { color: C.green, fontWeight: '900' }]}>
                    {String(selectedOrder.status)}
                  </Text>
                </View>

                {selectedOrder.fiat_amount && (
                  <View style={s.quoteRow}>
                    <Text style={s.quoteLabel}>Montant Fiat</Text>
                    <Text style={s.quoteValue}>{fmt(Number(selectedOrder.fiat_amount))} XOF</Text>
                  </View>
                )}

                {selectedOrder.crypto_asset && (
                  <View style={s.quoteRow}>
                    <Text style={s.quoteLabel}>Actif Crypto</Text>
                    <Text style={s.quoteValue}>{String(selectedOrder.crypto_asset)}</Text>
                  </View>
                )}

                {/* Dedicated Deposit Address (For Sell & Swap) */}
                {selectedOrder.deposit_address && (
                  <View style={s.depositCard}>
                    <Text style={s.depositTitle}>Adresse de dépôt temporaire dédiée :</Text>
                    <Text selectable style={s.depositAddress}>
                      {String(selectedOrder.deposit_address)}
                    </Text>
                    <Text style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
                      {t.depositAddressNotice}
                    </Text>
                  </View>
                )}

                {selectedOrder.receive_address && (
                  <View style={s.quoteRow}>
                    <Text style={s.quoteLabel}>Adresse de réception</Text>
                    <Text selectable style={[s.quoteValue, { fontSize: 10, maxWidth: 220 }]}>
                      {String(selectedOrder.receive_address)}
                    </Text>
                  </View>
                )}

                <Pressable
                  onPress={() => setSelectedOrder(null)}
                  style={[s.primaryButton, s.quoteButton]}
                >
                  <Text style={s.primaryButtonText}>Fermer</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </>
  );
}
