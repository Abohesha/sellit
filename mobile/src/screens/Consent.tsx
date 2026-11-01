import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { api } from '../api';
import { Button, styles } from '../ui';

// Bump when the privacy policy text changes so consent is recorded against a version.
export const PRIVACY_POLICY_VERSION = '2026-11-draft';

export function Consent({ onDone }: { onDone: () => void }) {
  const [privacy, setPrivacy] = useState(false);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    try {
      await api.consent(PRIVACY_POLICY_VERSION, ai);
      onDone();
    } catch {
      setError('Could not save your choice. Try again.');
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.h1}>Your data</Text>
      <Text style={styles.muted}>
        We store your photos and listing drafts in the EU. To write a draft, your photos are sent to an AI service. You review every draft
        before anything is published, and you can export or delete all your data at any time.
      </Text>
      {/* TODO: link the real privacy policy once written. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <Switch value={privacy} onValueChange={setPrivacy} />
        <Text style={{ flex: 1 }}>I have read the privacy policy.</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <Switch value={ai} onValueChange={setAi} />
        <Text style={{ flex: 1 }}>I agree to my photos being processed by an AI service to draft listings.</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Continue" onPress={accept} disabled={!privacy || !ai || busy} />
    </ScrollView>
  );
}
