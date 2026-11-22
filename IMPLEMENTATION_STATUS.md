## D?cision de p?rim?tre

Le produit SKALET couvre uniquement l’achat et la vente de crypto-actifs. Les échanges crypto contre crypto (swap) sont exclus, même si une version antérieure du cahier les mentionne.

# Suivi de mise en œuvre SKALET

Ce suivi est lié au cahier des charges V3. Le dépôt n’est pas complet : une ligne marquée « partiel » ne satisfait pas le critère d’acceptation correspondant. Aucune opération réelle n’est autorisée.

## État des modules fonctionnels

| Référence | État | Travail encore requis |
|---|---|---|
| M01 Comptes et authentification | Partiel | OTP, TOTP MFA chiffré et session back-office vérifiée présents ; fournisseur e-mail/SMS concret, récupération, changement de contact, révocation globale, sauvegardes de récupération et durcissement complet des sessions à faire. |
| M02 Profil, KYC/KYB et conformité | Partiel | Dossiers et décisions manuelles enregistrés ; fournisseur documentaire/liveness, sanctions/PEP, niveaux par pays, appels et rétention à faire. |
| M03 Actifs et réseaux | Partiel | Schéma BTC/ETH/USDT de départ inactif ; console, validation de contrats/décimales et états par fonction à faire. |
| M04 Adresses externes | Partiel | Validation syntaxique et enregistrement initial ; checksum multi-réseau, whitelist, délai de changement et alertes à faire. |
| M05 Prix, devis et liquidité | Partiel | Devis de démonstration en unités crypto entières ; sources réelles, fraîcheur, profondeur, spread configurable et coupe-circuits à faire. |
| M06 Achat crypto | Partiel | Création d’ordre démo ; prestataire fiat, instructions, confirmation vérifiée, livraison, reçu et exceptions à faire. |
| M07 Vente crypto | Partiel | Tables et statuts de base ; dépôts par ordre, confirmations, contrôle et paiement sortant à faire. |
| M08 Swap crypto | Partiel | Type d’ordre présent ; dépôt, liquidité, slippage et remboursement contrôlé à faire. |
| M09 Paiements fiat | Partiel | Ingestion de webhook HMAC et doublons ; adaptateurs contractés, rapprochement provider et payouts à faire. |
| M10 Exécution blockchain | Partiel | Tables d’événements uniquement ; indexeur, confirmations/reorg, frais, sorties, clés HSM/MPC et procédures à faire. |
| M11 Historique et reçus | Partiel | Historique des ordres et événements ; reçus exportables et vues d’erreur complètes à faire. |
| M12 Notifications | Partiel | Préférences et consentement/retiraits conservés ; fournisseurs, envoi multi-canal, journal, modèles et anti-phishing à faire. |
| M13 Parrainage et fidélité | Partiel | Codes et campagnes avec approbation à deux personnes ; récompenses post-transaction, budgets appliqués et antifraude à faire. |
| M14 Réclamations | Partiel | Tickets, messages et SLA de base ; pièces jointes protégées, escalades et parcours litige complet à faire. |
| M15 CRM et segmentation | À faire | Consentements, segments contrôlés, campagnes et exports audités. |
| M16 API marchands | Partiel | Clés API hashées à portée restreinte, révocation, quotas et devis de démonstration présents ; portail, commandes marchandes, webhooks sortants et documentation versionnée à faire. |
| M17 Partenaires | Partiel | Registre et tables ; intégrations, supervision, routage/failover, SLA et sortie partenaire à faire. |
| M18 Back-office et gouvernance | Partiel | Console Web de file de travail, rôles, MFA TOTP, journaux append-only et approbations à deux personnes ; permissions fines complètes, opérations auditables et récupération MFA à faire. |
| M19 Reporting | Partiel | Résumé de quelques indicateurs ; définitions, exports contrôlés, rapprochement officiel et rapports détaillés à faire. |

## Exigences transversales

- **Architecture partagée** : application Expo commune au Web, Android et Telegram ; règles `packages/core` et API commune initialisées.
- **Données** : migration PostgreSQL initiale prévue, append-only pour journal d’audit et écritures du ledger ; sauvegardes, restauration, chiffrement des documents et rétention à faire.
- **Sécurité** : signature HMAC Telegram et webhook, validation d’entrée, idempotence initiale, rôles et sessions présents ; MFA interne, revue de sécurité, scans, tests d’intrusion et gestion d’incident à faire.
- **Finance** : schéma du grand livre et contrôle débit/crédit équilibré ; intégration aux relevés et rapprochement automatisé à faire.
- **Cycle des ordres** : transitions autorisées centralisées ; un ordre ne peut passer à `COMPLETED` sans preuves de fonds/livraison et rapprochement associé. Aucun parcours d’exécution réel ne peut marquer un ordre terminé.
- **UX et langues** : socle français mobile-first ; anglais complet, accessibilité vérifiée, résilience réseau et appareils modestes à faire.
- **Qualité** : les critères AC-01 à AC-10 du cahier ne sont pas validés. Installation, build, tests unitaires/intégration, sécurité, UX, panne et restauration restent à réaliser.
- **Opérations** : environnements, CI/CD, alertes, RPO/RTO, procédures de support et continuité à faire.
- **Lancement** : avis juridique écrit, entité, pays, autorisations, contrats et due diligence des partenaires sont des prérequis externes, pas des cases que le code peut remplacer.

## Prochaine tranche de développement

1. Terminer les parcours clients : sélection pays/devise/actif/réseau, parcours achat et vente, devis serveur, validation des adresses, états d’ordre, reçus et support.
2. Construire les consoles back-office Support, Conformité, Paiements, Crypto, Finance et Supervision avec permissions précises et double contrôle.
3. Ajouter les adaptateurs sur environnements sandbox et les tests contractuels/idempotents ; aucun connecteur de production ne sera activé par défaut.
4. Compléter tests et exploitation, puis traiter les décisions et pièces réglementaires/partenaires propres au pays pilote.
