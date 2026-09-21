CREATE TABLE scheduled_message_drafts (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  nonce TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_json TEXT NOT NULL
);
CREATE TABLE admin_editor_state (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  editor TEXT NOT NULL CHECK (editor IN ('sequence', 'scheduled'))
);

-- Preserve unfinished broadcasts while moving them out of the sequence editor.
INSERT INTO scheduled_message_drafts(owner_id, nonce, revision, content_json)
SELECT owner_id, nonce, revision + 1, json_object(
  'id', json_extract(content_json, '$.campaign.id'),
  'title', json_extract(content_json, '$.campaign.title'),
  'baseRevision', json_extract(content_json, '$.campaign.baseRevision'),
  'locale', CASE WHEN json_extract(content_json, '$.campaign.fallback') = 'uk' THEN 'uk' ELSE 'en' END,
  'variants', json(COALESCE(json_extract(content_json, '$.campaign.steps[0].variants'), '{}')),
  'scheduledAt', json_extract(content_json, '$.campaign.scheduledAt'),
  'stage', CASE WHEN json_array_length(json_extract(content_json, '$.campaign.steps')) > 0 THEN 'calendar' ELSE 'content' END
)
FROM campaign_drafts WHERE json_extract(content_json, '$.campaign.kind') = 'broadcast';
INSERT INTO admin_editor_state(owner_id, editor) SELECT owner_id, 'scheduled' FROM scheduled_message_drafts;
DELETE FROM campaign_drafts WHERE json_extract(content_json, '$.campaign.kind') = 'broadcast';
DELETE FROM campaign_drafts WHERE json_extract(content_json, '$.campaign.id') IN (SELECT id FROM campaigns WHERE archived = 1);
