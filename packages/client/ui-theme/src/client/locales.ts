/** `settings.theme` namespace dictionaries for appearance and font preferences. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.title': '字号大小',
  'fontSize.description': '仅影响会话内容的字号',
  'fontSize.unit': 'px',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
  'fontFamily.text.title': '文本字体',
  'fontFamily.text.description': '用于界面和会话文本；使用已安装的字体，缺失时回退到默认字体',
  'fontFamily.code.title': '代码字体',
  'fontFamily.code.description': '用于代码和差异视图；使用已安装的字体，缺失时回退到默认字体',
  'fontFamily.terminal.title': '终端字体',
  'fontFamily.terminal.description': '用于终端输出；使用已安装的字体，缺失时回退到默认字体',
  'fontFamily.option.default': '标准（系统默认）',
  'fontFamily.option.meiryo': 'Meiryo',
  'fontFamily.option.yu-gothic': 'Yu Gothic',
  'fontFamily.option.hiragino-sans': 'Hiragino Sans',
  'fontFamily.option.noto-sans-jp': 'Noto Sans JP',
  'fontFamily.option.noto-serif-jp': 'Noto Serif JP',
  'fontFamily.option.consolas': 'Consolas',
  'fontFamily.option.menlo': 'Menlo',
  'fontFamily.option.ms-gothic': 'MS Gothic',
  'fontFamily.option.osaka-mono': 'Osaka 等宽',
  'fontFamily.option.noto-sans-mono-jp': 'Noto Sans Mono JP',
  'fontFamily.option.jetbrains-mono': 'JetBrains Mono',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'fontSize.title': 'Font size',
  'fontSize.description': 'Only affects conversation content',
  'fontSize.unit': 'px',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
  'fontFamily.text.title': 'Text font',
  'fontFamily.text.description':
    'Used for interface and conversation text. Uses installed fonts; unavailable fonts fall back to the default.',
  'fontFamily.code.title': 'Code font',
  'fontFamily.code.description': 'Used for code and diffs. Uses installed fonts; unavailable fonts fall back to the default.',
  'fontFamily.terminal.title': 'Terminal font',
  'fontFamily.terminal.description': 'Used for terminal output. Uses installed fonts; unavailable fonts fall back to the default.',
  'fontFamily.option.default': 'System default',
  'fontFamily.option.meiryo': 'Meiryo',
  'fontFamily.option.yu-gothic': 'Yu Gothic',
  'fontFamily.option.hiragino-sans': 'Hiragino Sans',
  'fontFamily.option.noto-sans-jp': 'Noto Sans JP',
  'fontFamily.option.noto-serif-jp': 'Noto Serif JP',
  'fontFamily.option.consolas': 'Consolas',
  'fontFamily.option.menlo': 'Menlo',
  'fontFamily.option.ms-gothic': 'MS Gothic',
  'fontFamily.option.osaka-mono': 'Osaka Mono',
  'fontFamily.option.noto-sans-mono-jp': 'Noto Sans Mono JP',
  'fontFamily.option.jetbrains-mono': 'JetBrains Mono',
} satisfies Record<ThemeKey, string>
