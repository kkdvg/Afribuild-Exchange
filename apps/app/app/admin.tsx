import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AuthPanel, API, loadToken } from '../src/AuthPanel';
import { C } from '../src/styles';
import { useI18n } from '../src/i18n';

type Section = 'Vue' | 'Ordres' | 'Conformité' | 'Risques' | 'Support' | 'Partenaires' | 'Trésorerie' | 'Audit';
const sections: Section[] = ['Vue', 'Ordres', 'Conformité', 'Risques', 'Support', 'Partenaires', 'Trésorerie', 'Audit'];

const endpoints: Record<Section, string> = {
  Vue: '/v1/admin/reports/summary',
  Ordres: '/v1/admin/orders',
  Conformité: '/v1/admin/kyc',
  Risques: '/v1/admin/risk-alerts',
  Support: '/v1/admin/tickets',
  Partenaires: '/v1/admin/partners',
  Trésorerie: '/v1/admin/reconciliations',
  Audit: '/v1/admin/audit',
};

export default function AdminPage() {
  const { lang, setLang, t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('Vue');
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<{ path: string; payload: Record<string, string> } | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    void loadToken().then(setToken).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    setError('');

    void fetch(`${API}${endpoints[section]}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Accès restreint au personnel habilité');
        return d;
      })
      .then(d => {
        if (!cancel) {
          const rows = d.items || d.orders || [];
          setItems(Array.isArray(rows) ? rows : []);
        }
      })
      .catch(e => {
        if (!cancel) {
          setItems([]);
          setError(e instanceof Error ? e.message : 'Chargement impossible');
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => { cancel = true; };
  }, [token, section, refresh]);

  function decide(path: string, payload: Record<string, string>) {
    setPending({ path, payload });
    setReason('');
  }

  async function confirmDecision() {
    if (!token || !pending || !reason.trim()) return;
    try {
      const response = await fetch(`${API}${pending.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...pending.payload, reason: reason.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Action refusée');
        return;
      }
      setPending(null);
      setRefresh(v => v + 1);
    } catch {
      setError('Erreur de communication avec l’API');
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Afribuild-Exchange · Console d’opérations', headerShown: true }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: '#F8FAFC' }}
        contentContainerStyle={{ padding: 24, maxWidth: 1100, width: '100%', alignSelf: 'center', paddingBottom: 60 }}
      >
        {/* Header Bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <View>
            <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: C.green }}>ESPACE INTERNE · GOUVERNANCE</Text>
            <Text style={{ fontSize: 26, fontWeight: '900', color: C.ink, marginTop: 4 }}>{t.adminTitle}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 3 }}>
              <Pressable onPress={() => setLang('fr')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: lang === 'fr' ? C.green : 'transparent' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: lang === 'fr' ? '#FFF' : C.muted }}>FR</Text>
              </Pressable>
              <Pressable onPress={() => setLang('en')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: lang === 'en' ? C.green : 'transparent' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: lang === 'en' ? '#FFF' : C.muted }}>EN</Text>
              </Pressable>
            </View>

            <Link href="/" asChild>
              <Pressable style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: C.green }}>← Application Client</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        {/* Warning Badge */}
        <View style={{ padding: 14, backgroundColor: '#FEF3C7', borderRadius: 14, marginBottom: 18, flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: '#FDE68A' }}>
          <Ionicons name="shield-half-outline" size={20} color="#B45309" />
          <Text style={{ flex: 1, fontSize: 11, lineHeight: 17, color: '#92400E', fontWeight: '500' }}>
            {t.adminWarning}
          </Text>
        </View>

        {!token ? (
          <AuthPanel onAuthenticated={setToken} />
        ) : (
          <>
            {/* Section Tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 52, marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
              {sections.map(name => (
                <Pressable
                  key={name}
                  onPress={() => setSection(name)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: section === name ? C.green : '#FFFFFF',
                    borderWidth: 1,
                    borderColor: section === name ? C.green : C.line,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: section === name ? '#FFFFFF' : C.muted }}>
                    {name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Decision Dialog Modal inline */}
            {!!pending && (
              <View style={{ padding: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, borderRadius: 16, marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: C.ink }}>Confirmer la décision de l'opérateur</Text>
                <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Un motif détaillé est exigé par la politique d'audit interne.</Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Motif officiel obligatoire (ex: Pièce d’identité vérifiée, preuve on-chain constatée...)"
                  placeholderTextColor={C.muted}
                  style={{ height: 46, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, marginTop: 10, fontSize: 12, color: C.ink }}
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable onPress={() => setPending(null)} style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: C.muted }}>Annuler</Text>
                  </Pressable>
                  <Pressable onPress={() => void confirmDecision()} disabled={!reason.trim()} style={{ backgroundColor: C.green, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, opacity: reason.trim() ? 1 : 0.6 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>Confirmer et consigner</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {loading && <ActivityIndicator color={C.green} style={{ margin: 30 }} />}
            {!!error && (
              <View style={{ padding: 14, backgroundColor: '#FEF2F2', borderRadius: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FECACA' }}>
                <Text style={{ fontSize: 12, color: '#B91C1C', fontWeight: '600' }}>{error}</Text>
              </View>
            )}

            {/* Section Views */}
            {section === 'Vue' && items.map((row, i) => (
              <Card key={i} title={String(row.status || row.kind || 'Statistique Synthétique')} subtitle={JSON.stringify(row, null, 2)} />
            ))}

            {section === 'Ordres' && items.map((row, i) => (
              <Card
                key={i}
                title={`${String(row.kind || 'ORDRE').toUpperCase()} · ${String(row.crypto_asset || '')} ${row.target_asset ? `→ ${row.target_asset}` : ''}`}
                subtitle={`${String(row.fiat_amount || '')} ${String(row.fiat_currency || 'XOF')} · Statut: ${String(row.status)} · Réf: ${String(row.id).slice(0, 14)}`}
              >
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Action text="Valider l’ordre" onPress={() => void decide(`/v1/admin/orders/${row.id}/review`, { decision: 'approve' })} />
                  <Action text="Rejeter l’ordre" danger onPress={() => void decide(`/v1/admin/orders/${row.id}/review`, { decision: 'reject' })} />
                </View>
              </Card>
            ))}

            {section === 'Conformité' && items.map((row, i) => (
              <Card
                key={i}
                title={`Dossier KYC: ${String(row.id).slice(0, 14)}`}
                subtitle={`Pays: ${String(row.country)} · Niveau: ${String(row.level)} · Statut actuel: ${String(row.status)}`}
              >
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Action text="Valider KYC" onPress={() => void decide(`/v1/admin/kyc/${row.id}/decision`, { decision: 'VERIFIED' })} />
                  <Action text="Rejeter KYC" danger onPress={() => void decide(`/v1/admin/kyc/${row.id}/decision`, { decision: 'REJECTED' })} />
                </View>
              </Card>
            ))}

            {section === 'Risques' && items.map((row, i) => (
              <Card
                key={i}
                title={`Alerte: ${String(row.alert_type)} · Score de risque: ${String(row.score)}`}
                subtitle={`${String(row.reason)} · Rattaché à l’ordre: ${String(row.order_id || 'Aucun')}`}
              >
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Action text="Classer sans suite" onPress={() => void decide(`/v1/admin/risk-alerts/${row.id}/decision`, { decision: 'CLEARED' })} />
                  <Action text="Escalader / Bloquer" danger onPress={() => void decide(`/v1/admin/risk-alerts/${row.id}/decision`, { decision: 'ESCALATED' })} />
                </View>
              </Card>
            ))}

            {section === 'Support' && items.map((row, i) => (
              <Card
                key={i}
                title={`Ticket Support · Catégorie: ${String(row.category)} (${String(row.priority)})`}
                subtitle={`Ticket ID: ${String(row.id).slice(0, 14)} · Échéance SLA: ${String(row.sla_due_at || 'Standard')} · Statut: ${String(row.status)}`}
              />
            ))}

            {section === 'Partenaires' && items.map((row, i) => (
              <Card
                key={i}
                title={String(row.name)}
                subtitle={`Pays: ${String(row.country)} · Statut: ${String(row.status)} · Licence vérifiée: ${String(row.licensed)}`}
              />
            ))}

            {section === 'Trésorerie' && items.map((row, i) => (
              <Card
                key={i}
                title={`Rapprochement: ${String(row.source)} · Statut: ${String(row.status)}`}
                subtitle={`Écart constaté: ${String(row.difference)} · Période: ${String(row.period_start)} → ${String(row.period_end)}`}
              />
            ))}

            {section === 'Audit' && items.map((row, i) => (
              <Card
                key={i}
                title={`Action: ${String(row.action)}`}
                subtitle={`Cible: ${String(row.resource_type)} ${String(row.resource_id)} · Horodatage: ${String(row.created_at)} · Motif: ${String(row.reason || 'N/A')}`}
              />
            ))}

            {!loading && !error && !items.length && (
              <View style={{ padding: 36, backgroundColor: '#FFFFFF', borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: C.line }}>
                <Ionicons name="file-tray-outline" size={32} color={C.muted} style={{ marginBottom: 10 }} />
                <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>Aucun élément en attente</Text>
                <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Tous les flux sont à jour pour cette section.</Text>
              </View>
            )}

            <Pressable onPress={() => setRefresh(v => v + 1)} style={{ alignSelf: 'flex-start', marginTop: 14, paddingVertical: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.green }}>⟳ Actualiser la vue</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <View style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, marginBottom: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: C.ink }}>{title}</Text>
      <Text style={{ fontSize: 11, lineHeight: 16, color: C.muted, marginTop: 4, marginBottom: children ? 10 : 0 }}>{subtitle}</Text>
      {children}
    </View>
  );
}

function Action({ text, onPress, danger }: { text: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: danger ? '#FEF2F2' : '#F0F9F5',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: danger ? '#FECACA' : '#C2E7D7',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '800', color: danger ? '#DC2626' : C.green }}>{text}</Text>
    </Pressable>
  );
}
