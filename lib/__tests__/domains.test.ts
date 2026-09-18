import { describe, expect, it } from 'vitest';

import { DOMAIN_LABELS, domainLabel } from '@/lib/domains';

describe('domainLabel', () => {
  it('names the deck’s own domains', () => {
    expect(domainLabel('family')).toBe('Family');
    expect(domainLabel('greetings-courtesy')).toBe('Greetings and manners');
    expect(domainLabel('verbs-core')).toBe('Everyday verbs');
    expect(domainLabel('ghmily')).toBe('Guess How Much I Love You');
  });

  it('names the domains being written now, before a card of theirs exists', () => {
    // The picker is driven by the cards, so these simply do not appear yet —
    // but the day the first one lands it must read properly, not as a slug.
    for (const slug of ['clothes', 'body', 'animals', 'toddler-talk', 'my-words']) {
      expect(DOMAIN_LABELS[slug], slug).toBeTruthy();
    }
    expect(domainLabel('toddler-talk')).toBe('Talking to a toddler');
  });

  it('makes the best of a slug nobody has named', () => {
    // A domain arrives as data, so this file can always be behind the deck.
    expect(domainLabel('winter-clothes')).toBe('Winter clothes');
    expect(domainLabel('weather')).toBe('Weather');
    expect(domainLabel('at_the_shop')).toBe('At the shop');
  });

  it('trims, and is empty for nothing at all', () => {
    expect(domainLabel('  family  ')).toBe('Family');
    expect(domainLabel('')).toBe('');
    expect(domainLabel('   ')).toBe('');
  });

  it('has no jargon in any label', () => {
    for (const label of Object.values(DOMAIN_LABELS)) {
      for (const word of ['aspect', 'diphthong', 'clitic', 'digraph', 'voiced']) {
        expect(label.toLowerCase(), label).not.toContain(word);
      }
    }
  });
});
