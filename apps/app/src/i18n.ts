import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import React from 'react';

export type Language = 'fr' | 'en';

export const translations = {
  fr: {
    // Topbar & Navigation
    brand: 'Afribuild-Exchange',
    marketTogo: 'AFRIQUE · XOF',
    secureMode: 'Mode sécurisé',
    navHome: 'Accueil',
    navTrade: 'Échanger',
    navBuy: 'Acheter',
    navSell: 'Vendre',
    navSwap: 'Swap',
    navActivity: 'Activité',
    navSettings: 'Paramètres',
    navSupport: 'Aide',
    navAccount: 'Compte',
    navAdmin: 'Console d’équipe',
    menu: 'MENU',
    secureSpace: 'ESPACE SÉCURISÉ',
    secureSpaceDesc: 'Vos crypto-actifs sont directement expédiés vers votre wallet externe. Afribuild-Exchange ne conserve pas vos fonds.',

    // Greeting & Hero
    greetingTitle: 'Bonjour, bienvenue.',
    greetingSub: 'Achetez, vendez et échangez vos cryptos en toute clarté.',
    heroBadge: 'LE COMPTOIR CRYPTO NON-CUSTODIAL',
    heroTitle: 'La crypto en Afrique,\nen toute confiance.',
    heroSub: 'Achetez avec T-Money, Flooz & MTN MoMo, vendez vers vos comptes mobiles ou swappez sans intermédiaire.',
    btnStart: 'Commencer',
    todayMarket: 'Le marché aujourd’hui',
    indicativePrices: 'Prix du marché en temps réel',
    indicativeTag: 'MARCHÉ DIRECT',
    chooseOperation: 'Tout commence ici',
    chooseOperationSub: 'Sélectionnez votre transaction',
    actionBuyTitle: 'Acheter',
    actionBuyDesc: 'Payez par T-Money, Moov Flooz, MTN MoMo ou Wave et recevez sur votre wallet.',
    actionSellTitle: 'Vendre',
    actionSellDesc: 'Envoyez vos cryptos et recevez instantanément vos FCFA en Mobile Money.',
    actionSwapTitle: 'Swap Crypto',
    actionSwapDesc: 'Échangez deux cryptos directement d’un wallet à un autre sans passer par le fiat.',

    // Common trade form
    tradeBuyTitle: 'Achetez vos crypto-actifs.',
    tradeSellTitle: 'Vendez vos cryptos contre FCFA.',
    tradeSwapTitle: 'Échangez vos cryptos en direct.',
    tradeDesc: 'Consultez votre estimation transparente avant de valider votre ordre. Aucun frais caché.',
    step1Buy: 'Indiquez le montant en FCFA',
    step2Buy: 'Sélectionnez le moyen de paiement',
    step3Buy: 'Entrez votre adresse de réception',
    step1Sell: 'Indiquez le montant crypto à vendre',
    step2Sell: 'Renseignez le numéro Mobile Money',
    step3Sell: 'Envoyez à l’adresse de dépôt dédiée',
    step1Swap: 'Choisissez l’actif source et l’actif cible',
    step2Swap: 'Vérifiez le taux de change et le slippage',
    step3Swap: 'Recevez directement sur votre wallet cible',

    // Estimation Card
    quoteHeadingBuy: 'Estimation d’achat',
    quoteHeadingSell: 'Estimation de vente',
    quoteHeadingSwap: 'Estimation de swap',
    labelAmountToPay: 'Montant à payer (FCFA)',
    labelCryptoToSell: 'Montant crypto à envoyer',
    labelCryptoToSwap: 'Montant source à échanger',
    labelSelectAsset: 'Choisir l’actif',
    labelSelectSourceAsset: 'Actif source',
    labelSelectTargetAsset: 'Actif de destination',
    labelPaymentMethod: 'Moyen de paiement',
    labelPayoutMethod: 'Réception des fonds (Mobile Money)',
    labelMobileNumber: 'Numéro de téléphone (+228...)',
    labelMobileName: 'Nom du titulaire du compte',
    labelReceiveAddress: 'Adresse externe de réception',
    labelRate: 'Cours indicatif',
    labelFees: 'Frais estimés inclus',
    labelReceiveEst: 'Vous recevez environ',
    btnCreateOrderDemo: 'Créer un ordre',
    btnConfirmOrder: 'Confirmer la transaction',
    disclaimerDemo: 'Comptoir non-custodial direct. Vos crypto-actifs et fonds mobiles sont transférés directement.',
    verifyAddressNotice: 'Vérifiez scrupuleusement l’adresse et le réseau. Les transactions blockchain sont irréversibles.',
    depositAddressNotice: 'Une adresse de dépôt temporaire dédiée sera générée spécifiquement pour cet ordre.',

    // Activity
    activityTitle: 'Vos opérations',
    activityEmptyTitle: 'Aucune transaction pour le moment',
    activityEmptyDesc: 'Vos ordres d’achat, de vente et de swap apparaîtront ici avec leur preuve blockchain.',
    orderId: 'Ordre',
    orderStatus: 'Statut',
    orderType: 'Type',
    orderReceipt: 'Reçu officiel',
    orderViewDetails: 'Détails & Suivi',
    orderExplorer: 'Voir sur l’explorateur',

    // Support / Help
    supportTitle: 'Centre d’assistance & Litiges',
    supportSubtitle: 'Notre équipe vous répond sous les délais SLA garantis.',
    supportCategory: 'Catégorie de la demande',
    supportCategoryGeneral: 'Question générale',
    supportCategoryPayment: 'Problème de paiement Mobile Money',
    supportCategoryBlockchain: 'Confirmation blockchain en attente',
    supportCategoryKyc: 'Vérification d’identité (KYC)',
    supportMessagePlaceholder: 'Décrivez votre problème en indiquant vos références d’ordre le cas échéant…',
    btnCreateTicket: 'Envoyer ma demande',
    ticketCreatedNotice: 'Ticket d’assistance créé avec succès :',

    // Account / Profile
    accountTitle: 'Mon profil & Sécurité',
    accountStatus: 'État du compte',
    accountCountry: 'Pays pilote',
    accountKycLevel: 'Vérification d’identité (KYC)',
    accountMfa: 'Authentification 2FA / TOTP',
    btnRequestKyc: 'Soumettre une vérification KYC',
    btnSetupMfa: 'Activer la double authentification (TOTP)',
    mfaNoticeSecret: 'Scannez ou saisissez ce secret dans Google Authenticator ou Twilio Authy :',
    mfaInputCode: 'Code à 6 chiffres généré',
    btnConfirmMfa: 'Valider la 2FA',
    btnLogout: 'Se déconnecter',
    teamPortalLink: 'Accéder à la console d’équipe (Opérations)',

    // Admin & Ops
    adminTitle: 'Console d’opérations Afribuild-Exchange',
    adminWarning: 'Accès restreint. Double authentification et justification obligatoires pour chaque décision.',
    adminTabOverview: 'Vue d’ensemble',
    adminTabOrders: 'Ordres',
    adminTabKyc: 'Conformité (KYC)',
    adminTabRisk: 'Alertes Risques',
    adminTabSupport: 'Tickets Support',
    adminTabPartners: 'Partenaires',
    adminTabTreasury: 'Rapprochements',
    adminTabAudit: 'Journal d’audit',

    // Auth Modal
    authLoginTitle: 'Connexion rapide',
    authRegisterTitle: 'Créer un compte Afribuild-Exchange',
    authPhoneOrEmail: 'Adresse e-mail ou téléphone (+228...)',
    btnSendOtp: 'Recevoir le code de vérification',
    btnVerifyOtp: 'Vérifier et continuer',
    authCodePlaceholder: 'Code à 6 chiffres reçu',
    authTotpPlaceholder: 'Code de sécurité 2FA',
    authSwitchMode: 'Changer d’adresse / numéro',

    // Languages
    language: 'Langue',
    langFr: 'Français',
    langEn: 'English',
  },
  en: {
    // Topbar & Navigation
    brand: 'Afribuild-Exchange',
    marketTogo: 'AFRICA · XOF',
    secureMode: 'Secure mode',
    navHome: 'Home',
    navTrade: 'Trade',
    navBuy: 'Buy',
    navSell: 'Sell',
    navSwap: 'Swap',
    navActivity: 'Activity',
    navSettings: 'Settings',
    navSupport: 'Support',
    navAccount: 'Account',
    navAdmin: 'Team Console',
    menu: 'MENU',
    secureSpace: 'SECURE ENVIRONMENT',
    secureSpaceDesc: 'Your crypto assets are sent directly to your self-hosted wallet. Afribuild-Exchange never custodies your funds.',

    // Greeting & Hero
    greetingTitle: 'Welcome back.',
    greetingSub: 'Buy, sell and swap crypto with utmost transparency.',
    heroBadge: 'NON-CUSTODIAL DIGITAL ASSET DESK',
    heroTitle: 'Crypto in Africa,\nsimple & secure.',
    heroSub: 'Buy using T-Money, Flooz & MTN MoMo, sell to your local mobile money or swap coins directly without middlemen.',
    btnStart: 'Get started',
    todayMarket: 'Today’s market',
    indicativePrices: 'Real-time indicative quotes · Sandbox mode',
    indicativeTag: 'INDICATIVE',
    chooseOperation: 'Get started',
    chooseOperationSub: 'Choose your transaction type',
    actionBuyTitle: 'Buy Crypto',
    actionBuyDesc: 'Pay with T-Money, Moov Flooz, MTN MoMo or Wave and receive straight into your wallet.',
    actionSellTitle: 'Sell Crypto',
    actionSellDesc: 'Send crypto to a one-time deposit address and get local FCFA mobile payouts instantly.',
    actionSwapTitle: 'Crypto Swap',
    actionSwapDesc: 'Directly exchange one crypto for another wallet-to-wallet with no fiat intermediary.',

    // Common trade form
    tradeBuyTitle: 'Buy digital assets.',
    tradeSellTitle: 'Sell crypto for FCFA cash.',
    tradeSwapTitle: 'Instant non-custodial swap.',
    tradeDesc: 'Review transparent live quotes before confirming your order. Zero hidden fees.',
    step1Buy: 'Enter the fiat amount in FCFA',
    step2Buy: 'Choose your payment provider',
    step3Buy: 'Provide your external receive address',
    step1Sell: 'Enter crypto amount to sell',
    step2Sell: 'Enter recipient Mobile Money number',
    step3Sell: 'Send to dedicated deposit address',
    step1Swap: 'Select source and target assets',
    step2Swap: 'Review exchange rate and slippage',
    step3Swap: 'Receive directly on your destination wallet',

    // Estimation Card
    quoteHeadingBuy: 'Buy estimate',
    quoteHeadingSell: 'Sell estimate',
    quoteHeadingSwap: 'Swap estimate',
    labelAmountToPay: 'Amount to pay (FCFA)',
    labelCryptoToSell: 'Crypto amount to sell',
    labelCryptoToSwap: 'Source crypto to swap',
    labelSelectAsset: 'Select crypto',
    labelSelectSourceAsset: 'Source crypto',
    labelSelectTargetAsset: 'Target crypto',
    labelPaymentMethod: 'Payment method',
    labelPayoutMethod: 'Payout method (Mobile Money)',
    labelMobileNumber: 'Mobile Money phone number (+228...)',
    labelMobileName: 'Account holder name',
    labelReceiveAddress: 'External receive address',
    labelRate: 'Indicative exchange rate',
    labelFees: 'Estimated fees included',
    labelReceiveEst: 'You will receive approximately',
    btnCreateOrderDemo: 'Create test order',
    btnConfirmOrder: 'Confirm transaction',
    disclaimerDemo: 'Demo mode. No real monetary transactions will be processed.',
    verifyAddressNotice: 'Please double-check your wallet address and network. Blockchain transactions are irreversible.',
    depositAddressNotice: 'A unique, one-time deposit address will be generated specifically for this order.',

    // Activity
    activityTitle: 'Transaction history',
    activityEmptyTitle: 'No transactions yet',
    activityEmptyDesc: 'Your buy, sell and swap orders will appear here along with verifiable on-chain proofs.',
    orderId: 'Order ID',
    orderStatus: 'Status',
    orderType: 'Type',
    orderReceipt: 'Official receipt',
    orderViewDetails: 'Details & Tracking',
    orderExplorer: 'View on blockchain explorer',

    // Support / Help
    supportTitle: 'Help Center & Dispute Resolution',
    supportSubtitle: 'Our dedicated team responds within guaranteed SLA timeframes.',
    supportCategory: 'Request category',
    supportCategoryGeneral: 'General question',
    supportCategoryPayment: 'Mobile Money payment issue',
    supportCategoryBlockchain: 'Pending blockchain transaction',
    supportCategoryKyc: 'Identity verification (KYC)',
    supportMessagePlaceholder: 'Describe your issue in detail, mentioning your order ID if applicable…',
    btnCreateTicket: 'Submit request',
    ticketCreatedNotice: 'Support ticket successfully submitted:',

    // Account / Profile
    accountTitle: 'Profile & Security',
    accountStatus: 'Account status',
    accountCountry: 'Pilot market',
    accountKycLevel: 'Identity verification (KYC)',
    accountMfa: 'Two-Factor Auth (TOTP)',
    btnRequestKyc: 'Submit KYC verification',
    btnSetupMfa: 'Enable 2FA / TOTP authentication',
    mfaNoticeSecret: 'Scan or type this secret key into Google Authenticator or Twilio Authy:',
    mfaInputCode: '6-digit generated code',
    btnConfirmMfa: 'Confirm 2FA',
    btnLogout: 'Sign out',
    teamPortalLink: 'Access Team Console (Operations)',

    // Admin & Ops
    adminTitle: 'Afribuild-Exchange Operations Console',
    adminWarning: 'Restricted area. Two-factor authentication and written rationale required for all actions.',
    adminTabOverview: 'Overview',
    adminTabOrders: 'Orders',
    adminTabKyc: 'Compliance (KYC)',
    adminTabRisk: 'Risk alerts',
    adminTabSupport: 'Support tickets',
    adminTabPartners: 'Partners',
    adminTabTreasury: 'Reconciliations',
    adminTabAudit: 'Audit trail',

    // Auth Modal
    authLoginTitle: 'Quick Sign In',
    authRegisterTitle: 'Create Afribuild-Exchange Account',
    authPhoneOrEmail: 'Email or phone number (+228...)',
    btnSendOtp: 'Send verification code',
    btnVerifyOtp: 'Verify and continue',
    authCodePlaceholder: '6-digit OTP code',
    authTotpPlaceholder: '2FA security code',
    authSwitchMode: 'Change email / phone number',

    // Languages
    language: 'Language',
    langFr: 'Français',
    langEn: 'English',
  },
};

type I18nContextType = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: typeof translations.fr;
};

const I18nContext = createContext<I18nContextType>({
  lang: 'fr',
  setLang: () => {},
  t: translations.fr,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>('fr');

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('skalet_lang') as Language;
        if (saved === 'fr' || saved === 'en') setLang(saved);
      }
    } catch {}
  }, []);

  function handleSetLang(newLang: Language) {
    setLang(newLang);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('skalet_lang', newLang);
      }
    } catch {}
  }

  return React.createElement(
    I18nContext.Provider,
    { value: { lang, setLang: handleSetLang, t: translations[lang] } },
    children
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
