## Session list

- tree "セッション":
  - treeitem "other-project 無題 {{age}}"
  - treeitem "長い日本語プロジェクト名を狭い画面で確認するテスト用ワークスペース Use the read tool twice {{age}}" [selected]

## Composer

- banner:
  - navigation "セッション階層": Use the read tool twice
  - button "その他の操作"
  - button "右サイドバーを開く"
  - tablist:
    - tab "チャット" [selected]
    - tab "トラジェクトリ"
- text: "Use the read tool twice in one assistant message: read a.txt and b.txt. Then reply with the single word DONE and stop. {{clock}}"
- button "コピー"
- status: 作業時間
- button "所要時間 {{duration}}"
- paragraph: DONE
- button "コピー"
- button "良い回答"
- button "問題のある回答"
- button "新しい会話へ分岐"
- text: {{clock}}
- textbox "メッセージ送信またはタスク実行、/ コマンド、@ ファイルまたはセッション"
- button "ファイルの追加またはコマンドの実行"
- 'button "アクセスモード、現在: ワークスペース内の変更"': ワークスペース内の変更
- button "モデルを選択、現在 長い日本語プロバイダー名を狭い画面で確認するテスト用表示名 · 長い日本語モデル名を狭い画面で確認するテスト用モデル" [expanded]: 長い日本語プロバイダー名を狭い画面で確認するテスト用表示名 長い日本語モデル名を狭い画面で確認するテスト用モデル
- button "メッセージを送信" [disabled]
- text: shiguredo/long-project-name-for-narrow-viewport-git-context-display:feature/長い日本語ブランチ名の表示を狭い画面で確認する
- button "1 ターン 2 ステップ · {{throughput}} tok/s": 1 ターン 2 ステップ{{throughput}} tok/s
- button "16K tok · キャッシュヒット 98%": 16K tokキャッシュヒット 98%

## Model selector

- group "モデルと推論レベル":
  - text: プロバイダー 長い日本語プロバイダー名を狭い画面で確認するテスト用表示名
  - menu "モデル":
    - group "DeepSeek":
      - text: DeepSeek
      - menuitemradio "DeepSeek-V4-Flash"
      - menuitemradio "DeepSeek-V4-Flash-Vision-Exp"
    - group "長い日本語プロバイダー名を狭い画面で確認するテスト用表示名":
      - text: 長い日本語プロバイダー名を狭い画面で確認するテスト用表示名
      - menuitemradio "長い日本語モデル名を狭い画面で確認するテスト用モデル" [checked]
