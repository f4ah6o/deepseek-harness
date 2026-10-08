/** Dictionary namespace owned by the composer Git status chip. */
export const NS = 'gitBranch'

/** Simplified Chinese dictionary; the key set also defines the public locale seat. */
export const zh = {
  'branch.aria': 'Git 分支：{ref}',
  'detached.aria': 'Git 分离 HEAD：{ref}',
} satisfies Record<string, string>

/** The Client UI locale key union. */
export type GitBranchKey = keyof typeof zh

/** English dictionary checked complete against the Chinese key set. */
export const en = {
  'branch.aria': 'Git branch: {ref}',
  'detached.aria': 'Detached Git HEAD: {ref}',
} satisfies Record<GitBranchKey, string>
