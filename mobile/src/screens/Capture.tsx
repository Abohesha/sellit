import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { PhotoKind } from '../api';
import { SHOTS } from '../shots';
import { Button, styles } from '../ui';

export interface CapturedPhoto {
  kind: PhotoKind;
  uri: string;
}

export function Capture({ onDone }: { onDone: (photos: CapturedPhoto[]) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [index, setIndex] = useState(0);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>Camera access</Text>
        <Text style={styles.muted}>Sellit needs the camera to photograph your item.</Text>
        <Button label="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const shot = SHOTS[index]!;
  const taken = photos.find((p) => p.kind === shot.kind);
  const isLast = index === SHOTS.length - 1;

  async function snap() {
    setError(null);
    try {
      const pic = await camera.current?.takePictureAsync({ quality: 0.7 });
      if (!pic) return;
      setPhotos((prev) => [...prev.filter((p) => p.kind !== shot.kind), { kind: shot.kind, uri: pic.uri }]);
    } catch {
      setError('Could not take the photo. Try again.');
    }
  }

  const next = () => (isLast ? onDone(photos) : setIndex(index + 1));
  const canContinue = Boolean(taken) || !shot.required;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={local.header}>
        <Text style={local.step}>
          Shot {index + 1} of {SHOTS.length}: {shot.title}
        </Text>
        <Text style={local.hint}>{shot.hint}</Text>
      </View>
      {taken ? <Image source={{ uri: taken.uri }} style={{ flex: 1 }} resizeMode="contain" /> : <CameraView ref={camera} style={{ flex: 1 }} facing="back" />}
      <View style={local.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        {taken ? (
          <>
            <Button label="Retake" onPress={() => setPhotos((p) => p.filter((x) => x.kind !== shot.kind))} secondary />
            <Button label={isLast ? 'Create draft' : 'Next'} onPress={next} />
          </>
        ) : (
          <>
            <Button label="Take photo" onPress={snap} />
            {!shot.required && <Button label={isLast ? 'Skip and create draft' : 'Skip'} onPress={next} secondary />}
          </>
        )}
        {!canContinue && <Text style={local.hint}>This shot is needed for an accurate draft.</Text>}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  header: { padding: 16, paddingTop: 48, backgroundColor: '#000' },
  step: { color: '#fff', fontSize: 18, fontWeight: '700' },
  hint: { color: '#ccc', marginTop: 4 },
  footer: { padding: 16, backgroundColor: '#000' },
});
