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

export default function LoginScreen() {
  const router = useRouter();
  const [identifiant, setIdentifiant] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setError('');
    const cleanId = identifiant.trim().replace(/\s+/g, '');
    if (!cleanId) {
      setError('Veuillez renseigner votre numéro de téléphone ou email.');
      return;
    }
    if (!password) {
      setError('Veuillez saisir votre mot de passe.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanId,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Identifiants incorrects');

      if (data.accessToken) {
        await saveToken(data.accessToken);
        router.replace('/');
      } else {
        throw new Error('Jeton de session non reçu');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de connexion');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Connexion · Afribuild', headerShown: false }} />
      <View style={s.root}>
        <View style={s.topbar}>
          <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="arrow-back" size={20} color={C.green} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.green }}>Retour</Text>
          </Pressable>
          <Text style={{ fontSize: 14, fontWeight: '900', color: C.ink }}>Connexion</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={s.content}
            contentContainerStyle={[s.contentInner, { maxWidth: 440, paddingTop: 28 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={[s.logo, { width: 44, height: 44, borderRadius: 12, marginBottom: 12 }]}>
                <Text style={[s.logoText, { fontSize: 22 }]}>A</Text>
              </View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.3 }}>
                Bon retour parmi nous
              </Text>
              <Text style={{ fontSize: 12, color: C.muted, marginTop: 4, textAlign: 'center' }}>
                Accédez à votre compte Afribuild et à vos ordres
              </Text>
            </View>

            <View style={[s.tradeCard, { padding: 22 }]}>
              {/* Identifiant */}
              <View style={{ marginBottom: 14 }}>
                <Text style={s.selectorLabel}>Numéro de téléphone (+228...) ou Email</Text>
                <TextInput
                  value={identifiant}
                  onChangeText={setIdentifiant}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="+228 90 00 00 00"
                  placeholderTextColor={C.muted}
                  style={s.addressInput}
                />
              </View>

              {/* Mot de passe */}
              <View style={{ marginBottom: 16 }}>
                <Text style={s.selectorLabel}>Mot de passe</Text>
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

              {!!error && (
                <Text style={{ fontSize: 11, color: C.danger, marginBottom: 12, fontWeight: '700', textAlign: 'center' }}>
                  {error}
                </Text>
              )}

              <Pressable
                onPress={handleLogin}
                disabled={busy}
                style={[s.primaryButton, { alignSelf: 'stretch', minHeight: 46 }]}
              >
                {busy ? (
                  <ActivityIndicator color={C.limeDark} />
                ) : (
                  <>
                    <Text style={s.primaryButtonText}>Se connecter</Text>
                    <Ionicons name="arrow-forward" size={18} color={C.limeDark} />
                  </>
                )}
              </Pressable>

              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 18, gap: 6 }}>
                <Text style={{ fontSize: 12, color: C.muted }}>Nouveau sur Afribuild ?</Text>
                <Pressable onPress={() => router.push('/register')}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: C.green }}>Créer un compte</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </>
  );
}
