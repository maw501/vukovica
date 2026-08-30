/**
 * The daily XP ring: today's points, drawn as an arc filling towards the goal.
 *
 * There is no SVG dependency in this app and no wish to add one for a single
 * shape, so the ring is two half-circles, each clipped to its own side and
 * rotated into place. The geometry lives in `lib/xp.ts` (`ringSweep`) where it
 * is unit-tested; everything here is the boxes that geometry moves.
 *
 * `hole` is the colour of the middle. It has to match whatever the ring sits on
 * — the disc is opaque, and a ring is a disc with a hole punched in it.
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';
import { DAILY_GOAL, goalFraction, ringSweep } from '@/lib/xp';

export interface XpRingProps {
  /** XP earned on the local day. */
  today: number;
  /** The ring's denominator. */
  goal?: number;
  /** Outer diameter, in points. */
  size?: number;
  /** How thick the ring itself is; the rest is the hole. */
  thickness?: number;
  /** The surface the ring is drawn on, painted into the middle. */
  hole?: string;
}

export function XpRing({
  today,
  goal = DAILY_GOAL,
  size = 68,
  thickness = 7,
  hole = colors.surface,
}: XpRingProps) {
  const fraction = goalFraction(today, goal);
  const sweep = ringSweep(fraction);
  // The goal met is the moment worth noticing, so it changes colour rather than
  // just stopping — the accent is the same red the streak uses.
  const fill = fraction >= 1 ? colors.accent : colors.primary;
  const inner = size - thickness * 2;

  return (
    <View
      style={[styles.ring, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${today} of ${goal} XP today`}
      testID="xp-ring"
    >
      <View
        style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}
      />
      <RingHalf side="right" size={size} rotate={sweep.right} colour={fill} />
      <RingHalf side="left" size={size} rotate={sweep.left} colour={fill} />
      <View
        style={[
          styles.hole,
          {
            top: thickness,
            left: thickness,
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: hole,
          },
        ]}
      />
      <Text style={styles.value} testID="xp-ring-value">
        {today}
      </Text>
    </View>
  );
}

/**
 * One half of the sweep.
 *
 * The clip is a half-width window over its own side of the ring. Inside it sits
 * a full-size frame, offset so its centre is the ring's centre, and inside
 * *that* a semicircle covering the frame's matching side. Rotating the frame
 * therefore swings the semicircle about the ring's centre, and only the part
 * that has swung into this side's window is visible.
 */
function RingHalf({
  side,
  size,
  rotate,
  colour,
}: {
  side: 'left' | 'right';
  size: number;
  rotate: number;
  colour: string;
}) {
  const half = size / 2;
  const rounded =
    side === 'right'
      ? { borderTopRightRadius: half, borderBottomRightRadius: half }
      : { borderTopLeftRadius: half, borderBottomLeftRadius: half };

  return (
    <View
      style={[
        styles.clip,
        { width: half, height: size },
        side === 'right' ? { left: half } : { left: 0 },
      ]}
    >
      <View
        style={[
          styles.frame,
          { width: size, height: size, left: side === 'right' ? -half : 0 },
          { transform: [{ rotate: `${rotate}deg` }] },
        ]}
      >
        <View
          style={[
            styles.leaf,
            { width: half, height: size, backgroundColor: colour },
            side === 'right' ? { left: half } : { left: 0 },
            rounded,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  /** The unearned part of the ring, showing through wherever no leaf covers it. */
  disc: { position: 'absolute', backgroundColor: colors.disabled },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  frame: { position: 'absolute', top: 0 },
  leaf: { position: 'absolute', top: 0 },
  hole: { position: 'absolute' },
  value: { fontSize: 20, fontWeight: '700', color: colors.text },
});
