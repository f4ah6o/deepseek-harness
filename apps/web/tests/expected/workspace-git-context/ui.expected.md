## Session list

- tree "Sessions":
  - treeitem "other-project Untitled {{age}}"
  - treeitem "Project Atlas Use the read tool twice {{age}}" [selected]

## Composer

- banner:
  - navigation "Session hierarchy": Use the read tool twice
  - button "More actions"
  - button "Open right sidebar"
  - tablist:
    - tab "Chat" [selected]
    - tab "Trajectory"
- text: "Use the read tool twice in one assistant message: read a.txt and b.txt. Then reply with the single word DONE and stop. 1970-1-1 {{clock}}"
- button "Copy"
- status: Completed
- button "Completed in {{duration}}"
- paragraph: DONE
- button "Copy"
- button "Good response"
- button "Bad response"
- button "Branch into a new conversation"
- text: 1970-1-1 {{clock}}
- textbox "Message or run a task, / commands, @ files or sessions"
- button "Add files or run commands"
- 'button "Access mode, current: Workspace Write"': Workspace Write
- button "Select model, current Fork Provider · Fork Model" [expanded]: Fork Provider Fork Model
- button "Send message" [disabled]
- text: shiguredo/zakuro-rs:develop
- button "1 turns 2 steps · {{throughput}} tok/s": 1 turns 2 steps{{throughput}} tok/s
- button "16K tok · Cache hit 98%": 16K tokCache hit 98%

## Model selector

- group "Model and reasoning effort":
  - text: Provider Fork Provider
  - menu "Model":
    - group "DeepSeek":
      - text: DeepSeek
      - menuitemradio "DeepSeek-V4-Flash"
      - menuitemradio "DeepSeek-V4-Flash-Vision-Exp"
    - group "Fork Provider":
      - text: Fork Provider
      - menuitemradio "Fork Model" [checked]
