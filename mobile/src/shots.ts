import type { PhotoKind } from './api';

export interface Shot {
  kind: PhotoKind;
  title: string;
  hint: string;
  required: boolean;
}

/** 3 to 5 guided shots. The label shot is how brand and size get read reliably. */
export const SHOTS: Shot[] = [
  { kind: 'front', title: 'Front', hint: 'The whole item, well lit, on a plain background.', required: true },
  { kind: 'back', title: 'Back', hint: 'The back or underside.', required: true },
  { kind: 'label', title: 'Tag or label', hint: 'Close-up of the brand and size tag.', required: true },
  { kind: 'flaw', title: 'Flaws (optional)', hint: 'Any marks, wear or damage. Skip if none.', required: false },
  { kind: 'extra', title: 'Extra angle (optional)', hint: 'Anything else a buyer would want to see.', required: false },
];
