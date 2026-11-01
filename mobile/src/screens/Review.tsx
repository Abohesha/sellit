import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CONDITIONS, type AiListing, type Condition, type Edits, type Mapping, type Uncertain } from '../api';
import { Button, styles } from '../ui';

const LOW_CONFIDENCE = 0.7;

function Warn<T>({ field }: { field: Uncertain<T> }) {
  if (field.value === null) return <Text style={styles.warn}>The AI could not find this. Please fill it in.</Text>;
  if (field.confidence < LOW_CONFIDENCE) {
    return <Text style={styles.warn}>The AI is not sure ({Math.round(field.confidence * 100)}%). Please check.</Text>;
  }
  return null;
}

export function Review({
  ai,
  mapping,
  currency,
  onSubmit,
}: {
  ai: AiListing;
  mapping: Mapping | null;
  currency: string;
  onSubmit: (edits: Edits) => Promise<void>;
}) {
  const [title, setTitle] = useState(ai.title);
  const [description, setDescription] = useState(ai.description);
  const [condition, setCondition] = useState<Condition>(ai.condition.value ?? 'GOOD');
  const [categoryId, setCategoryId] = useState(mapping?.categoryId ?? '');
  const [brand, setBrand] = useState(ai.brand.value ?? '');
  const [size, setSize] = useState(ai.size.value ?? '');
  const [colour, setColour] = useState(ai.colour.value ?? '');
  const [price, setPrice] = useState(String(Math.round((ai.priceRange.min + ai.priceRange.max) / 2)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceNumber = Number(price.replace(',', '.'));
  const valid = title.trim().length > 0 && title.length <= 80 && description.trim() && categoryId && priceNumber > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        condition,
        categoryId,
        brand: brand.trim() || null,
        size: size.trim() || null,
        colour: colour.trim() || null,
        aspects: ai.itemSpecifics,
        price: priceNumber,
      });
    } catch {
      setError('Could not save. Try again.');
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Review your draft</Text>
      <Text style={styles.muted}>The AI wrote this from your photos. Check every field before you publish.</Text>
      {ai.uncertaintyNotes.map((n) => (
        <Text key={n} style={styles.warn}>
          • {n}
        </Text>
      ))}

      <Text style={styles.label}>Title ({title.length}/80)</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={80} />

      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, { minHeight: 120 }]} value={description} onChangeText={setDescription} multiline />

      <Text style={styles.label}>Condition</Text>
      <Warn field={ai.condition} />
      <View style={styles.chips}>
        {CONDITIONS.map((c) => (
          <Pressable key={c} onPress={() => setCondition(c)} style={[styles.chip, c === condition && styles.chipOn]}>
            <Text style={[styles.chipText, c === condition && styles.chipTextOn]}>{c.replace('_', ' ').toLowerCase()}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>eBay category</Text>
      {mapping ? (
        <View style={styles.chips}>
          {mapping.candidates.map((c) => (
            <Pressable key={c.categoryId} onPress={() => setCategoryId(c.categoryId)} style={[styles.chip, c.categoryId === categoryId && styles.chipOn]}>
              <Text style={[styles.chipText, c.categoryId === categoryId && styles.chipTextOn]}>{c.categoryName}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <Text style={styles.warn}>No category suggestion found. Enter the eBay category ID.</Text>
          <TextInput style={styles.input} value={categoryId} onChangeText={setCategoryId} keyboardType="number-pad" />
        </>
      )}
      {mapping && mapping.requiredAspects.length > 0 && (
        <Text style={styles.muted}>eBay requires for this category: {mapping.requiredAspects.join(', ')}</Text>
      )}

      <Text style={styles.label}>Brand</Text>
      <Warn field={ai.brand} />
      <TextInput style={styles.input} value={brand} onChangeText={setBrand} />

      <Text style={styles.label}>Size</Text>
      <Warn field={ai.size} />
      <TextInput style={styles.input} value={size} onChangeText={setSize} />

      <Text style={styles.label}>Colour</Text>
      <Warn field={ai.colour} />
      <TextInput style={styles.input} value={colour} onChangeText={setColour} />

      <Text style={styles.label}>
        Price ({currency}) · suggested {ai.priceRange.min}–{ai.priceRange.max}
      </Text>
      <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />

      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Looks good: continue" onPress={submit} disabled={!valid || busy} />
    </ScrollView>
  );
}
