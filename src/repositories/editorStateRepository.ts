export interface EditorDraftRow {
  nonce: string;
  revision: number;
  content_json: string;
}

export class EditorStateRepository {
  constructor(readonly db: D1Database) {}
  async focus(owner: string, editor: "sequence" | "scheduled"): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO admin_editor_state(owner_id, editor) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET editor = excluded.editor",
      )
      .bind(owner, editor)
      .run();
  }
  async active(owner: string): Promise<"sequence" | "scheduled"> {
    const row = await this.db
      .prepare("SELECT editor FROM admin_editor_state WHERE owner_id = ?")
      .bind(owner)
      .first<{ editor: "sequence" | "scheduled" }>();
    return row?.editor ?? "sequence";
  }
  draft(owner: string): Promise<EditorDraftRow | null> {
    return this.db
      .prepare(
        "SELECT nonce, revision, content_json FROM scheduled_message_drafts WHERE owner_id = ?",
      )
      .bind(owner)
      .first();
  }
  async save(
    owner: string,
    nonce: string,
    revision: number,
    content: unknown,
  ): Promise<boolean> {
    const row =
      revision === 0
        ? await this.db
            .prepare(
              "INSERT OR IGNORE INTO scheduled_message_drafts(owner_id, nonce, revision, content_json) VALUES (?, ?, 1, ?) RETURNING revision",
            )
            .bind(owner, nonce, JSON.stringify(content))
            .first()
        : await this.db
            .prepare(
              "UPDATE scheduled_message_drafts SET revision = revision + 1, content_json = ? WHERE owner_id = ? AND nonce = ? AND revision = ? RETURNING revision",
            )
            .bind(JSON.stringify(content), owner, nonce, revision)
            .first();
    return !!row;
  }
  async discard(owner: string, nonce: string): Promise<void> {
    await this.db
      .prepare(
        "DELETE FROM scheduled_message_drafts WHERE owner_id = ? AND nonce = ?",
      )
      .bind(owner, nonce)
      .run();
  }
}
