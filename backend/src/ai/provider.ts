import type { PhotoKind } from './schema';

export interface VisionImage {
  kind: PhotoKind;
  /** Short-lived signed read URL. */
  url: string;
}

export interface VisionRequest {
  system: string;
  user: string;
  images: VisionImage[];
}

export interface VisionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Vendor-neutral seam. The AI provider/model is an open decision (see CLAUDE.md),
 * so no vendor SDK is wired in yet. Implement this interface once it is chosen.
 */
export interface VisionProvider {
  readonly name: string;
  complete(req: VisionRequest): Promise<VisionResult>;
}

export class UnconfiguredProvider implements VisionProvider {
  readonly name = 'none';
  async complete(): Promise<VisionResult> {
    throw new Error('AI provider is not configured (open decision). Set AI_PROVIDER and implement it in src/ai/providers.');
  }
}
