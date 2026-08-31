/**
 * The three-script text primitives.
 *
 * Every piece of content in the app is one of three things, and the app says
 * which by how it looks (`script` in `lib/theme.ts`):
 *
 *   - Serbian Cyrillic — the main text colour, in a serif. The star.
 *   - Latin transliteration — sans, in terracotta. The crutch, and the one role
 *     with an end date; see the token's comment.
 *   - English — sans, muted. The supporting matter.
 *
 * Chrome is not part of the scheme: buttons, headings, badges and the app's own
 * wording keep the styles they have. This is for *content*.
 *
 * `MixedText` exists because a good deal of the content is one string in two
 * languages — a letter mnemonic, a grammar prompt, the Books goal — and the
 * Serbian inside those has to look like Serbian too. `splitScriptRuns` does the
 * finding; this only renders it.
 */

import { Text, type TextProps, type TextStyle, type StyleProp } from 'react-native';

import { splitScriptRuns, type ScriptRole } from '@/lib/script';
import { script } from '@/lib/theme';

export type { ScriptRole } from '@/lib/script';
export { splitScriptRuns, hasCyrillic } from '@/lib/script';

/**
 * Everything a `Text` takes except `role`, which here means the script rather
 * than the ARIA role. Nothing in this app sets the ARIA one on a `Text`
 * (`accessibilityRole` is what every site uses), so the name is worth having.
 */
type ScriptTextProps = Omit<TextProps, 'role'> & { role: ScriptRole };

/**
 * A run of one kind of text.
 *
 * The role's colour and face go on first and the caller's `style` last, so a
 * site with a reason to override — a right/wrong mark, a heading that keeps its
 * own colour — still can, and every site that has no such reason gets the token.
 */
export function ScriptText({ role, style, ...rest }: ScriptTextProps) {
  return <Text {...rest} style={[script[role], style]} />;
}

/**
 * A string in two languages: `role` for the whole of it, with the Cyrillic runs
 * inside lifted into the Cyrillic style.
 *
 * `style` applies to the wrapper, so passing a heading's own style keeps the
 * heading looking like itself while the Serbian in it still turns serif.
 * `cyrStyle` does the same for the runs, and is rarely wanted.
 */
export function MixedText({
  role = 'en',
  style,
  cyrStyle,
  children,
  ...rest
}: Omit<ScriptTextProps, 'children' | 'role'> & {
  role?: ScriptRole;
  /** The string to split. Deliberately not `ReactNode`: there is nothing to split. */
  children: string;
  cyrStyle?: StyleProp<TextStyle>;
}) {
  return (
    <ScriptText {...rest} role={role} style={style}>
      {splitScriptRuns(children).map((segment, index) =>
        segment.cyrillic ? (
          <Text key={index} style={[script.cyr, cyrStyle]}>
            {segment.text}
          </Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        ),
      )}
    </ScriptText>
  );
}
