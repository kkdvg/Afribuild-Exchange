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
import { Link, Stack } from 'expo-router';
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

type Tab = 'Accueil' | 'Échanger' | 'Activité' | 'Paramètres';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);

export default function Home() {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState<Tab>('Accueil');
  const [kind, setKind] = useState<OrderKind>('buy');

  // Selected Assets & Providers
  const [selectedAsset, setSelectedAsset] = useState<Asset>(ASSETS[0]);
  const [targetAsset, setTargetAsset] = useState<Asset>(ASSETS[1]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PAYMENT_METHODS[0]);

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

  // Support
  const [ticketCategory, setTicketCategory] = useState('GENERAL');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketNotice, setTicketNotice] = useState('');

  // Account & Security
  const [kycStatus, setKycStatus] = useState('NOT_SUBMITTED');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNotice, setMfaNotice] = useState('');

  const idempotencyKey = useRef<string | null>(null);
  const quoteAttempt = useRef<{ id?: string; expiresAt?: string } | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const telegram = useTelegram();

  const navItems: { tab: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = useMemo(() => [
    { tab: 'Accueil', label: t.navHome, icon: 'home-outline', activeIcon: 'home' },
    { tab: 'Échanger', label: t.navTrade, icon: 'swap-horizontal-outline', activeIcon: 'swap-horizontal' },
    { tab: 'Activité', label: t.navActivity, icon: 'receipt-outline', activeIcon: 'receipt' },
    { tab: 'Paramètres', label: t.navSettings, icon: 'settings-outline', activeIcon: 'settings' },
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
    if (tab !== 'Activité' || !token) return;
    void fetch(`${API}/v1/orders`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setOrders(d.items || []))
      .catch(() => setOrders([]));
  }, [tab, token]);

  // Account / KYC loading
  useEffect(() => {
    if (tab !== 'Paramètres' || !token) return;
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

              <Pressable onPress={() => setTab('Paramètres')} style={s.avatar}>
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="shield-checkmark" size={15} color={C.green} />
                  <Text style={s.sideCaption}>{t.secureSpace}</Text>
                </View>
                <Text style={s.sideNote}>{t.secureSpaceDesc}</Text>
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
                  {tab === 'Accueil'
                    ? t.greetingTitle
                    : tab === 'Échanger'
                    ? (kind === 'buy' ? t.tradeBuyTitle : kind === 'sell' ? t.tradeSellTitle : t.tradeSwapTitle)
                    : tab === 'Activité'
                    ? t.activityTitle
                    : t.navSettings}
                </Text>
                <Text style={s.subtitle}>
                  {tab === 'Accueil'
                    ? t.greetingSub
                    : tab === 'Échanger'
                    ? t.tradeDesc
                    : tab === 'Activité'
                    ? t.indicativePrices
                    : 'Profil, sécurité, assistance & préférences'}
                </Text>
              </View>
              <View style={s.secureBadge}>
                <Ionicons name="shield-checkmark" size={15} color={C.green} />
                <Text style={s.secureText}>{t.secureMode}</Text>
              </View>
            </View>

            {/* TAB: ACCUEIL */}
            {tab === 'Accueil' && (
              <>
                <View style={s.hero}>
                  <View style={s.heroCopy}>
                    <View style={s.livePill}>
                      <View style={s.liveDot} />
                      <Text style={s.liveText}>{t.heroBadge}</Text>
                    </View>
                    <Text style={s.heroTitle}>{t.heroTitle}</Text>
                    <Text style={s.heroSub}>{t.heroSub}</Text>
                    <Pressable
                      style={s.primaryButton}
                      onPress={() => {
                        setKind('buy');
                        setTab('Échanger');
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
                      setTab('Échanger');
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
                      setTab('Échanger');
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
                      setTab('Échanger');
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
                        setTab('Échanger');
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
                      setTab('Échanger');
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
                      setTab('Échanger');
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
                      setTab('Échanger');
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

            {/* TAB: ÉCHANGER (Unified Trading Hub) */}
            {tab === 'Échanger' && (
              <View>
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

                <View style={[s.tradeLayout, !isWide && s.tradeStack]}>
                  {/* Trade Guide / Steps */}
                  <View style={s.tradeIntro}>
                    <Text style={s.eyebrow}>{t.brand} · {t.marketTogo}</Text>
                    <Text style={s.tradeTitle}>
                      {kind === 'buy' ? t.tradeBuyTitle : kind === 'sell' ? t.tradeSellTitle : t.tradeSwapTitle}
                    </Text>
                    <Text style={s.tradeDesc}>{t.tradeDesc}</Text>

                    <View style={s.steps}>
                      <View style={s.step}>
                        <Text style={s.stepN}>01</Text>
                        <Text style={s.stepText}>
                          {kind === 'buy' ? t.step1Buy : kind === 'sell' ? t.step1Sell : t.step1Swap}
                        </Text>
                      </View>
                      <View style={s.step}>
                        <Text style={s.stepN}>02</Text>
                        <Text style={s.stepText}>
                          {kind === 'buy' ? t.step2Buy : kind === 'sell' ? t.step2Sell : t.step2Swap}
                        </Text>
                      </View>
                      <View style={s.step}>
                        <Text style={s.stepN}>03</Text>
                        <Text style={s.stepText}>
                          {kind === 'buy' ? t.step3Buy : kind === 'sell' ? t.step3Sell : t.step3Swap}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Calculator & Order Form Card */}
                  <View style={[s.quoteCard, !isWide && s.quoteCardNarrow]}>
                    <Text style={s.quoteHeading}>
                      {kind === 'buy' ? t.quoteHeadingBuy : kind === 'sell' ? t.quoteHeadingSell : t.quoteHeadingSwap}
                    </Text>
                    <Text style={s.quoteHint}>{t.indicativePrices}</Text>

                    {/* Asset Picker (Source Asset) */}
                    <Text style={s.selectorLabel}>{kind === 'swap' ? t.labelSelectSourceAsset : t.labelSelectAsset}</Text>
                    <View style={s.chipGroup}>
                      {ASSETS.map(asset => (
                        <Pressable
                          key={asset.symbol}
                          onPress={() => {
                            setSelectedAsset(asset);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          style={[s.chip, selectedAsset.symbol === asset.symbol && s.chipSelected]}
                        >
                          <View style={[s.chipBadge, { backgroundColor: asset.badgeColor || C.green }]} />
                          <Text style={[s.chipText, selectedAsset.symbol === asset.symbol && s.chipTextSelected]}>
                            {asset.symbol}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {/* If Swap: Target Asset Picker */}
                    {kind === 'swap' && (
                      <>
                        <Text style={s.selectorLabel}>{t.labelSelectTargetAsset}</Text>
                        <View style={s.chipGroup}>
                          {ASSETS.filter(a => a.symbol !== selectedAsset.symbol).map(asset => (
                            <Pressable
                              key={asset.symbol}
                              onPress={() => {
                                setTargetAsset(asset);
                                quoteAttempt.current = null;
                                idempotencyKey.current = null;
                              }}
                              style={[s.chip, targetAsset.symbol === asset.symbol && s.chipSelected]}
                            >
                              <View style={[s.chipBadge, { backgroundColor: asset.badgeColor || C.green }]} />
                              <Text style={[s.chipText, targetAsset.symbol === asset.symbol && s.chipTextSelected]}>
                                {asset.symbol}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    )}

                    {/* Payment Method Picker (Buy & Sell) */}
                    {(kind === 'buy' || kind === 'sell') && (
                      <>
                        <Text style={s.selectorLabel}>{kind === 'buy' ? t.labelPaymentMethod : t.labelPayoutMethod}</Text>
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
                      </>
                    )}

                    {/* Amount Input */}
                    {kind === 'buy' ? (
                      <>
                        <View style={s.inputWrap}>
                          <TextInput
                            value={amountFiat}
                            onChangeText={v => {
                              setAmountFiat(v);
                              quoteAttempt.current = null;
                              idempotencyKey.current = null;
                            }}
                            keyboardType="number-pad"
                            style={s.amountInput}
                            placeholder="25 000"
                            placeholderTextColor={C.muted}
                          />
                          <Text style={s.inputUnit}>FCFA</Text>
                        </View>

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

                        {/* Receive Address Input */}
                        <TextInput
                          value={receiveAddress}
                          onChangeText={v => {
                            setReceiveAddress(v);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          autoCapitalize="none"
                          placeholder={`${t.labelReceiveAddress} (${selectedAsset.network})`}
                          placeholderTextColor={C.muted}
                          style={s.addressInput}
                        />
                        {addressValidation && (
                          <Text style={{ fontSize: 10, color: addressValidation.valid ? C.green : C.danger, marginTop: 4 }}>
                            {addressValidation.valid ? '✓ Adresse syntaxiquement valide' : addressValidation.error}
                          </Text>
                        )}
                      </>
                    ) : kind === 'sell' ? (
                      <>
                        <View style={s.inputWrap}>
                          <TextInput
                            value={cryptoAmount}
                            onChangeText={v => {
                              setCryptoAmount(v);
                              quoteAttempt.current = null;
                              idempotencyKey.current = null;
                            }}
                            keyboardType="decimal-pad"
                            style={s.amountInput}
                            placeholder="0.001"
                            placeholderTextColor={C.muted}
                          />
                          <Text style={s.inputUnit}>{selectedAsset.symbol}</Text>
                        </View>

                        {/* Mobile Money Payout Coordinates */}
                        <TextInput
                          value={payoutPhone}
                          onChangeText={setPayoutPhone}
                          keyboardType="phone-pad"
                          placeholder={t.labelMobileNumber}
                          placeholderTextColor={C.muted}
                          style={s.addressInput}
                        />
                        <TextInput
                          value={payoutName}
                          onChangeText={setPayoutName}
                          placeholder={t.labelMobileName}
                          placeholderTextColor={C.muted}
                          style={s.addressInput}
                        />
                      </>
                    ) : (
                      // SWAP
                      <>
                        <View style={s.inputWrap}>
                          <TextInput
                            value={swapSourceAmount}
                            onChangeText={v => {
                              setSwapSourceAmount(v);
                              quoteAttempt.current = null;
                              idempotencyKey.current = null;
                            }}
                            keyboardType="decimal-pad"
                            style={s.amountInput}
                            placeholder="0.001"
                            placeholderTextColor={C.muted}
                          />
                          <Text style={s.inputUnit}>{selectedAsset.symbol}</Text>
                        </View>

                        {/* Target Crypto Receiving Address */}
                        <TextInput
                          value={receiveAddress}
                          onChangeText={v => {
                            setReceiveAddress(v);
                            quoteAttempt.current = null;
                            idempotencyKey.current = null;
                          }}
                          autoCapitalize="none"
                          placeholder={`${t.labelReceiveAddress} (${targetAsset.symbol} - ${targetAsset.network})`}
                          placeholderTextColor={C.muted}
                          style={s.addressInput}
                        />
                        {addressValidation && (
                          <Text style={{ fontSize: 10, color: addressValidation.valid ? C.green : C.danger, marginTop: 4 }}>
                            {addressValidation.valid ? '✓ Adresse de destination valide' : addressValidation.error}
                          </Text>
                        )}
                      </>
                    )}

                    {/* Quote Breakdown */}
                    <View style={s.quoteDivider} />
                    <View style={s.quoteRow}>
                      <Text style={s.quoteLabel}>{t.labelRate}</Text>
                      <Text style={s.quoteValue}>
                        {kind === 'swap'
                          ? `1 ${selectedAsset.symbol} ≈ ${liveQuote?.indicativeRate ? liveQuote.indicativeRate.toFixed(4) : '?'} ${targetAsset.symbol}`
                          : `1 ${selectedAsset.symbol} = ${fmt(selectedAsset.priceXof)} XOF`}
                      </Text>
                    </View>
                    <View style={s.quoteRow}>
                      <Text style={s.quoteLabel}>{t.labelFees}</Text>
                      <Text style={s.quoteValue}>
                        {liveQuote ? `${fmt(liveQuote.feeFiat)} XOF` : '—'}
                      </Text>
                    </View>
                    <View style={s.quoteRow}>
                      <Text style={s.quoteLabel}>{t.labelReceiveEst}</Text>
                      <Text style={[s.quoteValue, s.quoteStrong]}>
                        {kind === 'buy' && liveQuote
                          ? `${liveQuote.estimatedAsset.toFixed(selectedAsset.decimals > 8 ? 6 : selectedAsset.decimals)} ${selectedAsset.symbol}`
                          : kind === 'sell' && liveQuote
                          ? `${fmt(liveQuote.estimatedFiat || 0)} XOF`
                          : kind === 'swap' && liveQuote
                          ? `${liveQuote.estimatedAsset.toFixed(targetAsset.decimals > 8 ? 6 : targetAsset.decimals)} ${targetAsset.symbol}`
                          : '—'}
                      </Text>
                    </View>

                    <Pressable
                      onPress={submitOrder}
                      disabled={busy || !liveQuote}
                      style={[s.primaryButton, s.quoteButton, (busy || !liveQuote) && { opacity: 0.7 }]}
                    >
                      {busy ? (
                        <ActivityIndicator color={C.limeDark} />
                      ) : (
                        <>
                          <Text style={s.primaryButtonText}>{t.btnCreateOrderDemo}</Text>
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
                      <AuthPanel
                        onAuthenticated={tkn => {
                          setToken(tkn);
                          setAuthRequired(false);
                        }}
                      />
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* TAB: ACTIVITÉ */}
            {tab === 'Activité' && (
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
                        setTab('Échanger');
                      }}
                      style={s.secondaryButton}
                    >
                      <Text style={s.secondaryButtonText}>{t.btnCreateOrderDemo}</Text>
                    </Pressable>
                  </View>
                )}

                {!token && (
                  <AuthPanel
                    onAuthenticated={tkn => {
                      setToken(tkn);
                    }}
                  />
                )}
              </>
            )}

            {/* TAB: PARAMÈTRES (Settings Hub with Profile, Security, Support, Language, Team) */}
            {tab === 'Paramètres' && (
              <View>
                {/* 1. Account / Profile */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Profil & Compte</Text>
                  <View style={s.settingsCard}>
                    <View style={s.settingsRow}>
                      <View style={[s.settingsIconBox, { backgroundColor: C.greenLight }]}>
                        <Ionicons name="person" size={16} color={C.green} />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Statut du compte</Text>
                        <Text style={s.settingsRowDesc}>{token ? 'Authentifié via OTP / Session' : 'Invité non connecté'}</Text>
                      </View>
                      <Text style={[s.settingsRowValue, token ? { color: C.green } : {}]}>
                        {token ? 'Connecté' : 'Invité'}
                      </Text>
                    </View>

                    <View style={[s.settingsRow, s.settingsRowLast]}>
                      <View style={[s.settingsIconBox, { backgroundColor: '#EFF6FF' }]}>
                        <Ionicons name="globe-outline" size={16} color="#2563EB" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Zone d’opération</Text>
                        <Text style={s.settingsRowDesc}>UEMOA · Franc CFA (XOF)</Text>
                      </View>
                      <Text style={s.settingsRowValue}>Togo (TG)</Text>
                    </View>
                  </View>
                </View>

                {/* 2. Security & Compliance */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Sécurité & Conformité</Text>
                  <View style={s.settingsCard}>
                    {/* KYC */}
                    <View style={s.settingsRow}>
                      <View style={[s.settingsIconBox, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name="shield-outline" size={16} color="#D97706" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Vérification d’identité (KYC)</Text>
                        <Text style={s.settingsRowDesc}>Niveau 1 standard</Text>
                      </View>
                      <Text style={[s.settingsRowValue, kycStatus === 'VERIFIED' && { color: C.green }]}>
                        {kycStatus}
                      </Text>
                    </View>

                    {token && (
                      <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                        <Pressable
                          onPress={async () => {
                            try {
                              const r = await fetch(`${API}/v1/kyc`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ country: 'TG' }),
                              });
                              const d = await r.json();
                              setKycStatus(d.status || d.error || 'PENDING');
                            } catch {
                              setKycStatus('Erreur API');
                            }
                          }}
                          style={[s.secondaryButton, { alignSelf: 'flex-start' }]}
                        >
                          <Text style={s.secondaryButtonText}>{t.btnRequestKyc}</Text>
                        </Pressable>
                      </View>
                    )}

                    {/* 2FA / MFA */}
                    <View style={s.settingsRow}>
                      <View style={[s.settingsIconBox, { backgroundColor: C.greenLight }]}>
                        <Ionicons name="key-outline" size={16} color={C.green} />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Authentification 2FA / TOTP</Text>
                        <Text style={s.settingsRowDesc}>Protection renforcée par Google Authenticator</Text>
                      </View>
                      <Text style={[s.settingsRowValue, mfaEnabled && { color: C.green }]}>
                        {mfaEnabled ? 'Activée' : 'Désactivée'}
                      </Text>
                    </View>

                    {token && !mfaEnabled && (
                      <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                        <Pressable
                          onPress={async () => {
                            try {
                              const r = await fetch(`${API}/v1/me/mfa/enroll`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}` },
                              });
                              const d = await r.json();
                              if (!r.ok) throw new Error(d.error);
                              setMfaSecret(d.secret);
                              setMfaNotice(t.mfaNoticeSecret);
                            } catch (e) {
                              setMfaNotice(e instanceof Error ? e.message : 'Enrôlement impossible');
                            }
                          }}
                          style={[s.secondaryButton, { alignSelf: 'flex-start' }]}
                        >
                          <Text style={s.secondaryButtonText}>{t.btnSetupMfa}</Text>
                        </Pressable>

                        {!!mfaSecret && (
                          <View style={{ marginTop: 10 }}>
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
                              onPress={async () => {
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
                                  setMfaNotice(d.message);
                                } catch (e) {
                                  setMfaNotice(e instanceof Error ? e.message : 'Code incorrect');
                                }
                              }}
                              style={[s.primaryButton, s.quoteButton]}
                            >
                              <Text style={s.primaryButtonText}>{t.btnConfirmMfa}</Text>
                            </Pressable>
                          </View>
                        )}
                        {!!mfaNotice && <Text style={s.notice}>{mfaNotice}</Text>}
                      </View>
                    )}
                  </View>
                </View>

                {/* 3. Preferences & Language */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Préférences & Langue</Text>
                  <View style={s.settingsCard}>
                    <View style={[s.settingsRow, s.settingsRowLast]}>
                      <View style={[s.settingsIconBox, { backgroundColor: '#F3E8FF' }]}>
                        <Ionicons name="language-outline" size={16} color="#7E22CE" />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>{t.language}</Text>
                        <Text style={s.settingsRowDesc}>Sélectionnez votre langue d'affichage</Text>
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
                  </View>
                </View>

                {/* 4. Support & Tickets */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>{t.supportTitle}</Text>
                  <View style={s.settingsCard}>
                    <View style={s.settingsRow}>
                      <View style={[s.settingsIconBox, { backgroundColor: C.greenLight }]}>
                        <Ionicons name="help-buoy-outline" size={16} color={C.green} />
                      </View>
                      <View style={s.settingsRowContent}>
                        <Text style={s.settingsRowTitle}>Support Client SLA 24/7</Text>
                        <Text style={s.settingsRowDesc}>{t.supportSubtitle}</Text>
                      </View>
                    </View>

                    <View style={{ padding: 14 }}>
                      <Text style={s.selectorLabel}>{t.supportCategory}</Text>
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
                        onPress={async () => {
                          if (!token) {
                            setAuthRequired(true);
                            setTicketNotice('Connectez-vous pour contacter le support.');
                            return;
                          }
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
                          }
                        }}
                        style={[s.primaryButton, s.quoteButton]}
                      >
                        <Text style={s.primaryButtonText}>{t.btnCreateTicket}</Text>
                        <Ionicons name="arrow-forward" size={18} color={C.limeDark} />
                      </Pressable>

                      {!!ticketNotice && <Text style={s.notice}>{ticketNotice}</Text>}
                    </View>
                  </View>
                </View>

                {/* 5. Team Operations Portal */}
                <View style={s.settingsSection}>
                  <Text style={s.settingsSectionTitle}>Espace Opérations & Équipe</Text>
                  <View style={s.settingsCard}>
                    <Link href="/admin" asChild>
                      <Pressable style={s.settingsRow}>
                        <View style={[s.settingsIconBox, { backgroundColor: C.greenLight }]}>
                          <Ionicons name="shield-checkmark" size={16} color={C.green} />
                        </View>
                        <View style={s.settingsRowContent}>
                          <Text style={s.settingsRowTitle}>{t.teamPortalLink}</Text>
                          <Text style={s.settingsRowDesc}>Supervision, réconciliation, ordres & audit</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={C.muted} />
                      </Pressable>
                    </Link>
                  </View>
                </View>

                {/* 6. Auth / Logout / Register */}
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
                        setTab('Accueil');
                      }
                    }}
                    style={[s.secondaryButton, { borderColor: '#FEE2E2', backgroundColor: '#FFF5F5', alignSelf: 'center', marginTop: 10 }]}
                  >
                    <Text style={[s.secondaryButtonText, { color: C.danger }]}>{t.btnLogout}</Text>
                  </Pressable>
                ) : (
                  <View style={{ marginTop: 10 }}>
                    <AuthPanel onAuthenticated={setToken} />
                  </View>
                )}
              </View>
            )}

            {/* Footer */}
            <View style={s.footer}>
              <View style={s.footerLock}>
                <Ionicons name="lock-closed" size={14} color={C.green} />
                <Text style={s.footerText}>{t.secureSpaceDesc}</Text>
              </View>

              <View style={s.footerLinks}>
                <Pressable onPress={() => setTab('Paramètres')}>
                  <Text style={s.footerLink}>{t.navSettings}</Text>
                </Pressable>
                <Link href="/admin" asChild>
                  <Pressable>
                    <Text style={s.footerLink}>{t.navAdmin}</Text>
                  </Pressable>
                </Link>
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

        {/* Order Details & Receipt Modal */}
        {selectedOrder && (
          <Modal transparent animationType="fade" visible={!!selectedOrder}>
            <View
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.5)',
                justifyContent: 'center',
                alignItems: 'center',
                padding: 16,
              }}
            >
              <View style={[s.quoteCard, { maxWidth: 500, width: '100%' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.quoteHeading}>{t.orderReceipt}</Text>
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
