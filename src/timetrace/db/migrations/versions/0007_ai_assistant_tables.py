"""Add the seven AI assistant tables

Revision ID: 0007_ai_assistant_tables
Revises: 0006_recurrence_rrule
Create Date: 2026-09-02 00:00:00.000000

Pure additive schema for docs/ai-assistant-spec.md section 4: seven new tables, no existing
table touched, no data migrated, no rows seeded.

Deliberate choices that look like omissions but are not:

  * `aidraftitem.target_id` has NO foreign key (precedent: `ratingentry.target_id`). It is
    polymorphic across task/session ids, and a target deleted between propose and accept must
    surface as a detectable *stale draft*, not be cascade-deleted before the user can read it.
  * `aidraftbatch.source_message_id` has NO foreign key. `aichatmessage.draft_batch_id` already
    points the other way; making both real FKs would be a circular pair.
  * `aiaudit.batch_id` / `item_id` / `entity_id` have NO foreign keys. An append-only history a
    cascade can delete is not an audit trail.
  * `aidraftbatch.conversation_id` is nullable with ON DELETE SET NULL -- deleting a chat thread
    must never destroy the audit trail of mutations that were actually applied.
  * `aiproviderconfig.is_active` is a plain index, not a partial unique index. "Exactly one
    active" is enforced in the service layer.
  * No seed row for `aisettings`. Singleton-ness is an application guarantee; the service creates
    the row on first read. Migration-time data is not needed and is not added.

No `sa.func.now()` anywhere -- revision 0002 shipped exactly that and broke every fresh database,
because SQLAlchemy's SQLite DateTime binder only accepts real `datetime` objects. This revision
inserts no rows at all, so it has no timestamp defaults to get wrong.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0007_ai_assistant_tables'
down_revision: str | None = '0006_recurrence_rrule'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- 1. aiproviderconfig ---------------------------------------------------------------
    op.create_table(
        'aiproviderconfig',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('model', sa.String(), nullable=False),
        sa.Column('base_url', sa.String(), nullable=True),
        sa.Column('api_key_encrypted', sa.String(), nullable=True),
        sa.Column('api_key_last4', sa.String(), nullable=True),
        sa.Column('temperature', sa.Float(), nullable=False),
        sa.Column('max_output_tokens', sa.Integer(), nullable=False),
        sa.Column('request_timeout_seconds', sa.Integer(), nullable=False),
        sa.Column('sanitization_level', sa.String(), nullable=False),
        sa.Column('use_native_openrouter', sa.Boolean(), nullable=False),
        sa.Column('extra_params_json', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_aiproviderconfig_is_active', 'aiproviderconfig', ['is_active'])

    # --- 2. aisettings (singleton, seeded by the service, not here) -------------------------
    op.create_table(
        'aisettings',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('quickadd_fallback_enabled', sa.Boolean(), nullable=False),
        sa.Column('redact_before_send', sa.Boolean(), nullable=False),
        sa.Column('preview_on_calendar', sa.Boolean(), nullable=False),
        sa.Column('scheduling_window_days', sa.Integer(), nullable=False),
        sa.Column('batch_undo_retention_days', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- 3. aiconversation ------------------------------------------------------------------
    op.create_table(
        'aiconversation',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('intent', sa.String(), nullable=True),
        sa.Column('provider_config_id', sa.String(), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False),
        sa.Column('message_count', sa.Integer(), nullable=False),
        sa.Column('total_input_tokens', sa.Integer(), nullable=False),
        sa.Column('total_output_tokens', sa.Integer(), nullable=False),
        sa.Column('last_message_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['provider_config_id'],
            ['aiproviderconfig.id'],
            name='fk_aiconversation_provider_config',
            ondelete='SET NULL',
        ),
    )
    op.create_index('ix_aiconversation_is_archived', 'aiconversation', ['is_archived'])

    # --- 4. aidraftbatch (before aichatmessage: the message references the batch) ------------
    op.create_table(
        'aidraftbatch',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('conversation_id', sa.String(), nullable=True),
        # source_message_id: plain String, no FK -- see module docstring.
        sa.Column('source_message_id', sa.String(), nullable=True),
        sa.Column('intent', sa.String(), nullable=True),
        sa.Column('request_text', sa.String(), nullable=True),
        sa.Column('summary', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('model', sa.String(), nullable=True),
        sa.Column('item_count', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('decided_at', sa.DateTime(), nullable=True),
        sa.Column('undone_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['conversation_id'],
            ['aiconversation.id'],
            name='fk_aidraftbatch_conversation',
            ondelete='SET NULL',
        ),
    )
    op.create_index('ix_aidraftbatch_conversation_id', 'aidraftbatch', ['conversation_id'])
    op.create_index('ix_aidraftbatch_status', 'aidraftbatch', ['status'])
    op.create_index('ix_aidraftbatch_created_at', 'aidraftbatch', ['created_at'])

    # --- 5. aichatmessage -------------------------------------------------------------------
    op.create_table(
        'aichatmessage',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('conversation_id', sa.String(), nullable=False),
        # position, not id, is the ORDER BY column: uuid7 is only coarsely monotonic and a
        # single turn mints several messages inside the same millisecond.
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('content', sa.String(), nullable=False),
        sa.Column('tool_calls_json', sa.String(), nullable=True),
        sa.Column('tool_call_id', sa.String(), nullable=True),
        sa.Column('tool_name', sa.String(), nullable=True),
        sa.Column('draft_batch_id', sa.String(), nullable=True),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('model', sa.String(), nullable=True),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('error', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['conversation_id'],
            ['aiconversation.id'],
            name='fk_aichatmessage_conversation',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['draft_batch_id'],
            ['aidraftbatch.id'],
            name='fk_aichatmessage_draft_batch',
            ondelete='SET NULL',
        ),
    )
    op.create_index('ix_aichatmessage_conversation_id', 'aichatmessage', ['conversation_id'])
    op.create_index('ix_aichatmessage_position', 'aichatmessage', ['position'])

    # --- 6. aidraftitem ---------------------------------------------------------------------
    op.create_table(
        'aidraftitem',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('batch_id', sa.String(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('op', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        # target_id: no FK -- polymorphic, and a deleted target must yield a detectable
        # stale draft rather than a cascade that eats the proposal.
        sa.Column('target_id', sa.String(), nullable=True),
        sa.Column('proposed_json', sa.String(), nullable=False),
        sa.Column('baseline_json', sa.String(), nullable=True),
        sa.Column('applied_before_json', sa.String(), nullable=True),
        sa.Column('applied_after_json', sa.String(), nullable=True),
        sa.Column('applied_entity_id', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('rationale', sa.String(), nullable=True),
        sa.Column('error', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['batch_id'],
            ['aidraftbatch.id'],
            name='fk_aidraftitem_batch',
            ondelete='CASCADE',
        ),
    )
    op.create_index('ix_aidraftitem_batch_id', 'aidraftitem', ['batch_id'])
    op.create_index('ix_aidraftitem_target_id', 'aidraftitem', ['target_id'])
    op.create_index('ix_aidraftitem_status', 'aidraftitem', ['status'])

    # --- 7. aiaudit (append-only; no FKs at all, by design) ---------------------------------
    op.create_table(
        'aiaudit',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('batch_id', sa.String(), nullable=False),
        sa.Column('item_id', sa.String(), nullable=True),
        sa.Column('transition', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=True),
        sa.Column('entity_id', sa.String(), nullable=True),
        sa.Column('before_json', sa.String(), nullable=True),
        sa.Column('after_json', sa.String(), nullable=True),
        sa.Column('actor', sa.String(), nullable=False),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_aiaudit_batch_id', 'aiaudit', ['batch_id'])
    op.create_index('ix_aiaudit_item_id', 'aiaudit', ['item_id'])
    op.create_index('ix_aiaudit_entity_id', 'aiaudit', ['entity_id'])
    op.create_index('ix_aiaudit_created_at', 'aiaudit', ['created_at'])


def downgrade() -> None:
    """Drops all seven tables. Purely additive upgrade, so this is a genuine inverse
    of the *schema*; any AI conversations, drafts and audit rows written since the
    upgrade are destroyed with the tables and are not recoverable from anywhere but a
    backup in `~/.timetrace/backups/`.

    Dropped in reverse dependency order (children first).
    """
    op.drop_index('ix_aiaudit_created_at', table_name='aiaudit')
    op.drop_index('ix_aiaudit_entity_id', table_name='aiaudit')
    op.drop_index('ix_aiaudit_item_id', table_name='aiaudit')
    op.drop_index('ix_aiaudit_batch_id', table_name='aiaudit')
    op.drop_table('aiaudit')

    op.drop_index('ix_aidraftitem_status', table_name='aidraftitem')
    op.drop_index('ix_aidraftitem_target_id', table_name='aidraftitem')
    op.drop_index('ix_aidraftitem_batch_id', table_name='aidraftitem')
    op.drop_table('aidraftitem')

    op.drop_index('ix_aichatmessage_position', table_name='aichatmessage')
    op.drop_index('ix_aichatmessage_conversation_id', table_name='aichatmessage')
    op.drop_table('aichatmessage')

    op.drop_index('ix_aidraftbatch_created_at', table_name='aidraftbatch')
    op.drop_index('ix_aidraftbatch_status', table_name='aidraftbatch')
    op.drop_index('ix_aidraftbatch_conversation_id', table_name='aidraftbatch')
    op.drop_table('aidraftbatch')

    op.drop_index('ix_aiconversation_is_archived', table_name='aiconversation')
    op.drop_table('aiconversation')

    op.drop_table('aisettings')

    op.drop_index('ix_aiproviderconfig_is_active', table_name='aiproviderconfig')
    op.drop_table('aiproviderconfig')
