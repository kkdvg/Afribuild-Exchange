export type OrderKind = 'buy' | 'sell' | 'swap';

export type Asset = {
  symbol: string;
  name: string;
  glyph: string;
  priceXof: number;
  decimals: number;
  network: string;
  badgeColor?: string;
};

export const ASSETS: Asset[] = [
  { symbol: 'USDT', name: 'Tether TRC-20', glyph: '₮', priceXof: 625, decimals: 6, network: 'TRON', badgeColor: '#26A17B' },
  { symbol: 'USDC', name: 'USD Coin', glyph: '$', priceXof: 625, decimals: 6, network: 'Solana', badgeColor: '#2775CA' },
  { symbol: 'SOL', name: 'Solana', glyph: '◎', priceXof: 128_500, decimals: 9, network: 'Solana', badgeColor: '#9945FF' },
  { symbol: 'TON', name: 'Toncoin', glyph: '💎', priceXof: 3_650, decimals: 9, network: 'TON', badgeColor: '#0088CC' },
  { symbol: 'BNB', name: 'BNB Smart Chain', glyph: '❖', priceXof: 410_000, decimals: 18, network: 'BSC', badgeColor: '#F3BA2F' },
  { symbol: 'TRX', name: 'TRON', glyph: '♦', priceXof: 135, decimals: 6, network: 'TRON', badgeColor: '#FF0013' },
  { symbol: 'XRP', name: 'Ripple', glyph: '✕', priceXof: 920, decimals: 6, network: 'Ripple', badgeColor: '#23292F' },
  { symbol: 'DOGE', name: 'Dogecoin', glyph: 'Ð', priceXof: 160, decimals: 8, network: 'Dogecoin', badgeColor: '#C2A633' },
];

export type PaymentMethodId = 'TMONEY' | 'FLOOZ' | 'MOMO' | 'WAVE' | 'CARD';
export type PaymentMethod = {
  id: PaymentMethodId;
  name: string;
  subname: string;
  operator: string;
  country: string;
  feePercent: number;
  badgeColor: string;
};

export const PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'TMONEY', name: 'T-Money', subname: 'TogoCom', operator: 'Togo Telecom', country: 'TG', feePercent: 1.5, badgeColor: '#008542' },
  { id: 'FLOOZ', name: 'Moov Flooz', subname: 'Moov Africa', operator: 'Moov Africa', country: 'TG', feePercent: 1.5, badgeColor: '#004B9B' },
  { id: 'MOMO', name: 'MTN MoMo', subname: 'MTN Mobile Money', operator: 'MTN', country: 'UEMOA', feePercent: 1.5, badgeColor: '#FFCC00' },
  { id: 'WAVE', name: 'Wave Mobile Money', subname: 'Région UEMOA', operator: 'Wave', country: 'UEMOA', feePercent: 1.0, badgeColor: '#1DC4FF' },
  { id: 'CARD', name: 'Carte Bancaire', subname: 'Visa / Mastercard', operator: 'Banque', country: 'ALL', feePercent: 2.5, badgeColor: '#1A1F36' },
];

export type Quote = {
  kind: OrderKind;
  amountFiat: number;
  asset: string;
  targetAsset?: string;
  inputAmount?: string;
  estimatedFiat?: number;
  indicativeRate: number;
  feeFiat: number;
  estimatedAsset: number;
  estimatedAssetUnits: string;
  slippageTolerancePercent?: number;
  expiresAt: string;
  mode: 'demo';
};

export function parseUnits(value: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2] || '').length > decimals) return null;
  return BigInt(match[1]) * (10n ** BigInt(decimals)) + BigInt(((match[2] || '').padEnd(decimals, '0')) || '0');
}

export function formatUnits(units: string | bigint, decimals: number, maxDecimals = 6): string {
  const n = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const whole = n / scale;
  const fraction = (n % scale).toString().padStart(decimals, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function createQuote(kind: OrderKind, amountFiat: number, asset: Asset): Quote {
  amountFiat = Math.trunc(Math.max(0, amountFiat));
  const spreadNumerator = kind === 'sell' ? 985n : 1015n;
  const rate = Number(BigInt(asset.priceXof) * spreadNumerator) / 1000;
  const feeFiat = Math.round(amountFiat * 0.015);
  const units = (BigInt(Math.max(0, amountFiat - feeFiat)) * (10n ** BigInt(asset.decimals)) * 1000n) / (BigInt(asset.priceXof) * spreadNumerator);
  return {
    kind,
    amountFiat,
    asset: asset.symbol,
    indicativeRate: rate,
    feeFiat,
    estimatedAsset: Number(units) / (10 ** asset.decimals),
    estimatedAssetUnits: units.toString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: 'demo',
  };
}

export function createSellQuote(cryptoAmount: string, asset: Asset): Quote | null {
  const input = parseUnits(cryptoAmount, asset.decimals);
  if (input === null || input <= 0n) return null;
  const gross = (input * BigInt(asset.priceXof)) / (10n ** BigInt(asset.decimals));
  const net = (gross * 985n) / 1000n;
  const fee = Number(gross - net);
  return {
    kind: 'sell',
    amountFiat: Number(net),
    asset: asset.symbol,
    inputAmount: input.toString(),
    estimatedFiat: Number(net),
    indicativeRate: asset.priceXof * 0.985,
    feeFiat: fee,
    estimatedAsset: Number(input) / (10 ** asset.decimals),
    estimatedAssetUnits: input.toString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: 'demo',
  };
}

export function createSwapQuote(sourceCryptoAmount: string, sourceAsset: Asset, targetAsset: Asset): Quote | null {
  const input = parseUnits(sourceCryptoAmount, sourceAsset.decimals);
  if (input === null || input <= 0n) return null;

  // Valeur brute en XOF de la crypto source
  const sourceValueXof = (input * BigInt(sourceAsset.priceXof)) / (10n ** BigInt(sourceAsset.decimals));
  // Marge de conversion de 1%
  const netValueXof = (sourceValueXof * 990n) / 1000n;
  const feeFiat = Number(sourceValueXof - netValueXof);

  // Conversion vers l'actif cible en unités précises
  const targetUnits = (netValueXof * (10n ** BigInt(targetAsset.decimals))) / BigInt(targetAsset.priceXof);
  const rateRatio = (sourceAsset.priceXof * 0.99) / targetAsset.priceXof;

  return {
    kind: 'swap',
    amountFiat: Number(sourceValueXof),
    asset: sourceAsset.symbol,
    targetAsset: targetAsset.symbol,
    inputAmount: input.toString(),
    estimatedFiat: Number(netValueXof),
    indicativeRate: rateRatio,
    feeFiat,
    estimatedAsset: Number(targetUnits) / (10 ** targetAsset.decimals),
    estimatedAssetUnits: targetUnits.toString(),
    slippageTolerancePercent: 0.5,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    mode: 'demo',
  };
}

export const orderStatuses = [
  'DRAFT',
  'QUOTED',
  'AWAITING_PAYMENT',
  'PAYMENT_DETECTED',
  'AWAITING_CRYPTO',
  'CRYPTO_DETECTED',
  'UNDER_REVIEW',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export type OrderStatus = typeof orderStatuses[number];

const orderTransitions: Record<string, readonly string[]> = {
  DRAFT: ['QUOTED', 'AWAITING_PAYMENT', 'AWAITING_CRYPTO', 'UNDER_REVIEW', 'CANCELLED', 'EXPIRED'],
  QUOTED: ['AWAITING_PAYMENT', 'AWAITING_CRYPTO', 'CANCELLED', 'EXPIRED'],
  AWAITING_PAYMENT: ['PAYMENT_DETECTED', 'UNDER_REVIEW', 'CANCELLED', 'EXPIRED'],
  PAYMENT_DETECTED: ['UNDER_REVIEW', 'EXECUTING', 'FAILED', 'REFUND_PENDING'],
  AWAITING_CRYPTO: ['CRYPTO_DETECTED', 'UNDER_REVIEW', 'CANCELLED', 'EXPIRED'],
  CRYPTO_DETECTED: ['UNDER_REVIEW', 'EXECUTING', 'FAILED', 'REFUND_PENDING'],
  UNDER_REVIEW: ['EXECUTING', 'FAILED', 'REFUND_PENDING'],
  EXECUTING: ['COMPLETED', 'FAILED', 'REFUND_PENDING'],
  FAILED: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  COMPLETED: [],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionOrder(from: string, to: string): boolean {
  return orderTransitions[from]?.includes(to) ?? false;
}

export function validateCryptoAddress(address: string, network: string): { valid: boolean; error?: string } {
  const clean = address.trim();
  const net = network.toLowerCase();

  if (net.includes('bitcoin') || net === 'btc') {
    const isBtc = /^(bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(clean);
    return isBtc ? { valid: true } : { valid: false, error: 'Format d’adresse Bitcoin invalide' };
  }
  if (net.includes('tron') || net === 'trx') {
    const isTron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(clean);
    return isTron ? { valid: true } : { valid: false, error: 'Format d’adresse TRON invalide (commence par T, 34 caractères)' };
  }
  if (net.includes('ethereum') || net.includes('erc20') || net.includes('polygon') || net.includes('bsc')) {
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(clean);
    return isEvm ? { valid: true } : { valid: false, error: 'Format d’adresse EVM / BSC invalide (commence par 0x, 42 caractères)' };
  }
  if (net.includes('solana') || net === 'sol') {
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
    return isSol ? { valid: true } : { valid: false, error: 'Format d’adresse Solana invalide (Base58 de 32 à 44 caractères)' };
  }
  if (net.includes('ton')) {
    const isTon = /^[a-zA-Z0-9_\-]{48}$/.test(clean);
    return isTon ? { valid: true } : { valid: false, error: 'Format d’adresse TON invalide (48 caractères)' };
  }
  if (net.includes('ripple') || net.includes('xrp')) {
    const isXrp = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(clean);
    return isXrp ? { valid: true } : { valid: false, error: 'Format d’adresse Ripple (XRP) invalide' };
  }
  if (net.includes('doge')) {
    const isDoge = /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/.test(clean);
    return isDoge ? { valid: true } : { valid: false, error: 'Format d’adresse Dogecoin invalide' };
  }
  return { valid: true };
}

export function validateOrder(input: { kind: unknown; amount?: unknown; asset: unknown; targetAsset?: unknown }) {
  if (!['buy', 'sell', 'swap'].includes(String(input.kind))) {
    throw new Error('Type d’opération invalide');
  }
  if (input.kind === 'buy' && (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount) || input.amount < 1000 || input.amount > 5_000_000)) {
    throw new Error('Montant invalide (1 000–5 000 000 XOF)');
  }
  if (!ASSETS.some(a => a.symbol === input.asset)) {
    throw new Error('Actif source indisponible');
  }
  if (input.kind === 'swap') {
    if (!input.targetAsset || !ASSETS.some(a => a.symbol === input.targetAsset)) {
      throw new Error('Actif de destination invalide');
    }
    if (input.asset === input.targetAsset) {
      throw new Error('L’actif source et l’actif de destination doivent être différents');
    }
  }
  return true;
}
