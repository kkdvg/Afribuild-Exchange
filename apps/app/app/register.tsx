import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C, styles as s } from '../src/styles';
import { API, saveToken } from '../src/AuthPanel';

const COUNTRIES = [
  { code: 'TG', name: 'Togo (+228)', prefix: '+228' },
  { code: 'BJ', name: 'Bénin (+229)', prefix: '+229' },
  { code: 'CI', name: 'Côte d’Ivoire (+225)', prefix: '+225' },
  { code: 'SN', name: 'Sénégal (+221)', prefix: '+221' },
  { code: 'BF', name: 'Burkina Faso (+226)', prefix: '+226' },
  { code: 'ML', name: 'Mali (+223)', prefix: '+223' },
  { code: 'NE', name: 'Niger (+227)', prefix: '+227' },
];

export default function RegisterScreen() {
  const router = useRouter();
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [numero, setNumero] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');
    if (!nom.trim() || !prenom.trim()) {
      setError('Veuillez renseigner votre nom et votre prénom.');
      return;
    }
    const cleanNum = numero.trim().replace(/\s+/g, '');
    if (!cleanNum || cleanNum.length < 8) {
      setError('Veuillez renseigner un numéro de téléphone valide.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Le mot de passe doit comporter au moins 6 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    const fullPhone = cleanNum.startsWith('+') ? cleanNum : `${country.prefix}${cleanNum}`;

    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: nom.trim(),
          prenom: prenom.trim(),
          phone: fullPhone,
          country: country.code,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création du compte');

      if (data.accessToken) {
        await saveToken(data.accessToken);
        router.replace('/');
      } else {
        router.replace('/login');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de créer le compte');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Inscription · Afribuild', headerShown: false }} />
      <View style={s.root}>
        <View style={s.topbar}>
          <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="arrow-back" size={20} color={C.green} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.green }}>Retour</Text>
          </Pressable>
          <Text style={{ fontSize: 14, fontWeight: '900', color: C.ink }}>Créer un compte</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={s.content}
            contentContainerStyle={[s.contentInner, { maxWidth: 480, paddingTop: 20 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={[s.logo, { width: 44, height: 44, borderRadius: 12, marginBottom: 10 }]}>
                <Text style={[s.logoText, { fontSize: 22 }]}>A</Text>
              </View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.3 }}>
                Rejoignez Afribuild
              </Text>
              <Text style={{ fontSize: 12, color: C.muted, marginTop: 4, textAlign: 'center' }}>
                Comptoir crypto direct & non-custodial pour l’Afrique
              </Text>
            </View>

            <View style={[s.tradeCard, { padding: 20 }]}>
              {/* Nom & Prénom */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.selectorLabel}>Prénom</Text>
                  <TextInput
                    value={prenom}
                    onChangeText={setPrenom}
                    placeholder="Ex: Koffi"
                    placeholderTextColor={C.muted}
                    style={s.addressInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.selectorLabel}>Nom</Text>
                  <TextInput
                    value={nom}
                    onChangeText={setNom}
                    placeholder="Ex: Mensah"
                    placeholderTextColor={C.muted}
                    style={s.addressInput}
                  />
                </View>
              </View>

              {/* Pays */}
              <View style={{ marginBottom: 12 }}>
                <Text style={s.selectorLabel}>Pays de résidence</Text>
                <View style={s.chipGroup}>
                  {COUNTRIES.map(c => (
                    <Pressable
                      key={c.code}
                      onPress={() => setCountry(c)}
                      style={[s.chip, country.code === c.code && s.chipSelected]}
                    >
                      <Text style={[s.chipText, country.code === c.code && s.chipTextSelected]}>
                        {c.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Numéro de téléphone */}
              <View style={{ marginBottom: 12 }}>
                <Text style={s.selectorLabel}>Numéro de téléphone ({country.prefix})</Text>
                <TextInput
                  value={numero}
                  onChangeText={setNumero}
                  keyboardType="phone-pad"
                  placeholder="90 00 00 00"
                  placeholderTextColor={C.muted}
                  style={s.addressInput}
                />
              </View>

              {/* Mot de passe */}
              <View style={{ marginBottom: 12 }}>
                <Text style={s.selectorLabel}>Mot de passe (minimum 6 caractères)</Text>
                <View style={[s.addressInput, { flexDirection: 'row', alignItems: 'center', paddingRight: 10 }]}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    placeholder="••••••••"
                    placeholderTextColor={C.muted}
                    style={{ flex: 1, height: '100%', fontSize: 13, color: C.ink }}
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.muted} />
                  </Pressable>
                </View>
              </View>

              {/* Confirmer Mot de passe */}
              <View style={{ marginBottom: 16 }}>
                <Text style={s.selectorLabel}>Confirmer le mot de passe</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor={C.muted}
                  style={s.addressInput}
                />
              </View>

              {!!error && (
                <Text style={{ fontSize: 11, color: C.danger, marginBottom: 10, fontWeight: '700', textAlign: 'center' }}>
                  {error}
                </Text>
              )}

              <Pressable
                onPress={handleRegister}
                disabled={busy}
                style={[s.primaryButton, { alignSelf: 'stretch', minHeight: 46 }]}
              >
                {busy ? (
                  <ActivityIndicator color={C.limeDark} />
                ) : (
                  <>
                    <Text style={s.primaryButtonText}>Créer mon compte</Text>
                    <Ionicons name="arrow-forward" size={18} color={C.limeDark} />
                  </>
                )}
              </Pressable>

              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16, gap: 6 }}>
                <Text style={{ fontSize: 12, color: C.muted }}>Déjà inscrit ?</Text>
                <Pressable onPress={() => router.push('/login')}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: C.green }}>Se connecter</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </>
  );
}
