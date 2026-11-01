import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ApiError, api, pollUntil, type Edits, type ItemView, type Marketplace } from './src/api';
import { Capture, type CapturedPhoto } from './src/screens/Capture';
import { Consent } from './src/screens/Consent';
import { Review } from './src/screens/Review';
import { SignIn } from './src/screens/SignIn';
import { supabase } from './src/supabase';
import { Busy, Button, styles } from './src/ui';

type Stage =
  | { name: 'consent' }
  | { name: 'capture' }
  | { name: 'working'; message: string }
  | { name: 'review'; itemId: string; marketplace: Marketplace; view: ItemView }
  | { name: 'done'; url: string }
  | { name: 'error'; message: string };

const consentKey = (userId: string) => `consent:${userId}`;

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [stage, setStage] = useState<Stage>({ name: 'capture' });
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    AsyncStorage.getItem(consentKey(session.user.id)).then((v) => {
      if (!v) setStage({ name: 'consent' });
    });
  }, [session]);

  if (session === undefined) return <Busy message="Loading" />;
  if (!session) return <SignIn />;

  async function createDraft(captured: CapturedPhoto[]) {
    setPhotos(captured);
    try {
      const [marketplace] = await api.marketplaces(); // MVP: first enabled marketplace; add a picker when more are live
      if (!marketplace) throw new Error('No marketplace is enabled');

      setStage({ name: 'working', message: 'Uploading photos' });
      const { id: itemId } = await api.createItem();
      for (const p of captured) await api.uploadPhoto(itemId, p.kind, p.uri);

      setStage({ name: 'working', message: 'Writing your draft' });
      await api.requestDraft(itemId, marketplace.id);
      const view = await pollUntil(
        () => api.getItem(itemId),
        (v) => v.draft !== null || v.draftJob?.status === 'failed',
      );
      if (!view.draft) throw new Error(view.draftJob?.error ?? 'The draft could not be created');
      setStage({ name: 'review', itemId, marketplace, view });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ai_consent_required') return setStage({ name: 'consent' });
      setStage({ name: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    }
  }

  async function publish(itemId: string, marketplace: Marketplace, edits: Edits) {
    await api.review(itemId, edits);
    const connections = await api.ebayConnections();
    if (!connections.find((c) => c.marketplaceId === marketplace.id)?.connected) {
      setStage({ name: 'working', message: 'Connecting your eBay account' });
      const { url } = await api.ebayConnectUrl(marketplace.id);
      // eBay redirects to the backend, which redirects to sellit://ebay-connected. Never ask for an eBay password here.
      await WebBrowser.openAuthSessionAsync(url, 'sellit://ebay-connected');
      const after = await api.ebayConnections();
      if (!after.find((c) => c.marketplaceId === marketplace.id)?.connected) {
        return setStage({ name: 'error', message: 'eBay was not connected. Your draft is saved; try again.' });
      }
    }
    setStage({ name: 'working', message: 'Publishing to eBay' });
    await api.publish(itemId, marketplace.id);
    const view = await pollUntil(
      () => api.getItem(itemId, marketplace.id),
      (v) => v.published !== null || v.publishJob?.status === 'failed',
    );
    if (view.published) setStage({ name: 'done', url: view.published.url });
    else setStage({ name: 'error', message: view.publishJob?.error ?? 'Publishing failed' });
  }

  const body = (() => {
    switch (stage.name) {
      case 'consent':
        return (
          <Consent
            onDone={async () => {
              await AsyncStorage.setItem(consentKey(session.user.id), '1');
              setStage(photos.length ? { name: 'working', message: 'Resuming' } : { name: 'capture' });
              if (photos.length) void createDraft(photos);
            }}
          />
        );
      case 'capture':
        return <Capture onDone={createDraft} />;
      case 'working':
        return <Busy message={stage.message} />;
      case 'review':
        return (
          <Review
            ai={stage.view.draft!.ai}
            mapping={stage.view.draft!.mapping}
            currency={stage.marketplace.currency}
            onSubmit={(edits) =>
              publish(stage.itemId, stage.marketplace, edits).catch((err) => {
                setStage({ name: 'error', message: err instanceof Error ? err.message : 'Publishing failed' });
              })
            }
          />
        );
      case 'done':
        return (
          <View style={styles.center}>
            <Text style={styles.h1}>Listed on eBay</Text>
            <Text style={styles.muted}>{stage.url}</Text>
            <Button label="Open listing" onPress={() => Linking.openURL(stage.url)} />
            <Button label="List another item" onPress={() => setStage({ name: 'capture' })} secondary />
          </View>
        );
      case 'error':
        return (
          <View style={styles.center}>
            <Text style={styles.h1}>Something went wrong</Text>
            <Text style={styles.error}>{stage.message}</Text>
            <Button label="Start again" onPress={() => setStage({ name: 'capture' })} />
          </View>
        );
    }
  })();

  return (
    <View style={{ flex: 1 }}>
      {body}
      <StatusBar style="auto" />
    </View>
  );
}
