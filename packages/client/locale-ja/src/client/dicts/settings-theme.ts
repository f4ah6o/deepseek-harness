/** Japanese dictionary for the `settings.theme` namespace (client/ui-theme/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `settings.theme` key union declared by @deepseek-ai/dsh-client-ui-theme.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

/** `settings.theme` copy in Japanese, complete against the owner's key union. */
export const ja: LocaleDictOf<'settings.theme'> = {
  'appearance.title': '外観',
  'appearance.light': 'ライト',
  'appearance.dark': 'ダーク',
  'appearance.system': 'システム',
  'fontSize.title': 'フォントサイズ',
  'fontSize.description': '会話の内容にのみ影響します',
  'fontSize.unit': 'px',
  'fontSize.increase': 'フォントサイズを大きくする',
  'fontSize.decrease': 'フォントサイズを小さくする',
  'fontFamily.text.title': 'テキストフォント',
  'fontFamily.text.description':
    '画面と会話のテキストに適用します。インストール済みのフォントを使用し、利用できない場合は既定のフォントに戻ります。',
  'fontFamily.code.title': 'コードフォント',
  'fontFamily.code.description':
    'コードと差分に適用します。インストール済みのフォントを使用し、利用できない場合は既定のフォントに戻ります。',
  'fontFamily.terminal.title': 'ターミナルフォント',
  'fontFamily.terminal.description':
    'ターミナルの出力に適用します。インストール済みのフォントを使用し、利用できない場合は既定のフォントに戻ります。',
  'fontFamily.option.default': '標準（システム既定）',
  'fontFamily.option.meiryo': 'メイリオ',
  'fontFamily.option.yu-gothic': '游ゴシック',
  'fontFamily.option.hiragino-sans': 'ヒラギノ角ゴシック',
  'fontFamily.option.noto-sans-jp': 'Noto Sans JP',
  'fontFamily.option.noto-serif-jp': 'Noto Serif JP',
  'fontFamily.option.consolas': 'Consolas',
  'fontFamily.option.menlo': 'Menlo',
  'fontFamily.option.ms-gothic': 'MS ゴシック',
  'fontFamily.option.osaka-mono': 'Osaka－等幅',
  'fontFamily.option.noto-sans-mono-jp': 'Noto Sans Mono JP',
  'fontFamily.option.jetbrains-mono': 'JetBrains Mono',
}
