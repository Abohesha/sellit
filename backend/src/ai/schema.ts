import { z } from 'zod';

export const CONDITIONS = ['NEW', 'LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const PHOTO_KINDS = ['front', 'back', 'label', 'flaw', 'extra'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

const evidence = z.enum(['tag', 'photo', 'inferred', 'unknown']);

/** A value the AI may be unsure about: always carries confidence and where it came from. */
const uncertain = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    source: evidence,
  });

const text = (max: number) => z.string().trim().min(1).max(max);

export const aiListingSchema = z.strictObject({
  title: text(80), // eBay title limit
  description: text(4000),
  category: uncertain(text(200)),
  brand: uncertain(text(100)),
  size: uncertain(text(50)),
  colour: uncertain(text(50)),
  condition: uncertain(z.enum(CONDITIONS)),
  priceRange: z
    .strictObject({
      min: z.number().positive(),
      max: z.number().positive(),
      currency: z.string().length(3),
    })
    .refine((p) => p.min <= p.max, { message: 'priceRange.min must be <= max' }),
  itemSpecifics: z.record(z.string().max(60), z.string().max(200)),
  uncertaintyNotes: z.array(z.string().max(300)).max(10),
});

export type AiListing = z.infer<typeof aiListingSchema>;

/** Parse model text into a validated listing. Throws a short, model-readable error. */
export function parseAiListing(text: string): AiListing {
  const json = extractJson(text);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Output was not valid JSON');
  }
  const result = aiListingSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`JSON failed schema validation: ${issues}`);
  }
  return result.data;
}

function extractJson(text: string): string {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Output contained no JSON object');
  return unfenced.slice(start, end + 1);
}
