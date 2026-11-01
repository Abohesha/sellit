import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { supabase } from '../supabase';
import { Button, styles } from '../ui';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(mode: 'in' | 'up') {
    setBusy(true);
    setError(null);
    const creds = { email: email.trim(), password };
    const { error: err } = mode === 'in' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    if (err) setError(err.message);
    else if (mode === 'up') setError('Check your email to confirm your account, then sign in.');
    setBusy(false);
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Sellit</Text>
      <Text style={styles.muted}>Photograph it. Review it. List it on eBay.</Text>
      <Text style={styles.label}>Email</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Sign in" onPress={() => submit('in')} disabled={busy || !email || !password} />
      <Button label="Create account" onPress={() => submit('up')} disabled={busy || !email || !password} secondary />
    </View>
  );
}
