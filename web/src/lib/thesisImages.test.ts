import { describe, expect, it } from 'vitest';
import { imageDetailsSchema, validImageData } from './thesisImages';
describe('thesis image boundaries', () => {
 it('allows supported raster signatures and rejects active/spoofed content', () => {
  expect(validImageData('data:image/png;base64,iVBORw0KGgoAAA==')).toBe(true);
  expect(validImageData('data:image/jpeg;base64,/9j/AA==')).toBe(true);
  expect(validImageData('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  expect(validImageData('data:image/png;base64,PHNjcmlwdD4=')).toBe(false);
  expect(validImageData('data:image/jpeg;base64,' + 'A'.repeat(1_400_000))).toBe(false);
 });
 it('validates source links and bounds user captions', () => {
  const details = { title: 'Product', category: 'Product', sourceUrl: 'https://example.com/slide' };
  expect(imageDetailsSchema.safeParse(details).success).toBe(true);
  for (const sourceUrl of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) expect(imageDetailsSchema.safeParse({...details,sourceUrl}).success).toBe(false);
  expect(imageDetailsSchema.safeParse({...details,caption:'x'.repeat(2001)}).success).toBe(false);
 });
});
