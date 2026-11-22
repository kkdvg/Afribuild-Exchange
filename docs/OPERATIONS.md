# Configuration opérationnelle (développement)

## Créer le premier compte interne

Inscris d’abord un compte depuis l’application en mode développement, puis retrouve son UUID par son e-mail ou téléphone. Attribue uniquement le rôle nécessaire via une connexion PostgreSQL protégée :

```sql
INSERT INTO user_roles(user_id, role)
SELECT id, 'supervisor' FROM users WHERE email = 'operateur@exemple.test'
ON CONFLICT (user_id, role) DO NOTHING;
```

L’attribution de rôles est volontairement absente de l’API publique. Les accès internes doivent être octroyés hors bande par un administrateur de base de données, journalisés et revus régulièrement.

## Accès partenaires

Les tables de partenaires et de fournisseurs sont des registres, pas des connecteurs. Un prestataire ne peut être utilisé qu’après développement et revue de son adaptateur, vérification de sa signature, gestion des doublons et contrat/licence vérifiés. La réception de webhook de paiement requiert un secret `PAYMENT_WEBHOOK_SECRET_<NOM>` et n’entraîne pas à elle seule l’envoi de crypto ni un paiement sortant.

## Limites de l’état actuel

Ne pas utiliser de données client réelles. Les codes OTP sont émis dans le terminal en développement. Il faut encore ajouter un fournisseur de délivrabilité, MFA interne, sessions de renouvellement/révocation globale, rétention et anonymisation, chiffrement des documents, gestion d’incidents, sauvegardes/restauration, exports contrôlés, adaptateurs externes, états détaillés et interfaces de back-office avant un pilote réel.
