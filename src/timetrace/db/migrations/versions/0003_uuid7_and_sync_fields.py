"""Add external calendar sync fields and ExternalSyncState table

Revision ID: 0003_uuid7_and_sync_fields
Revises: 0002_add_task_statuses_and_subtasks
Create Date: 2026-08-20 00:00:00.000000

Note: this revision id was already stamped onto some hand-modified development
databases before this script existed (the columns/table below were added
directly with raw SQL, bypassing Alembic). This script exists so that
`alembic upgrade head` is reproducible on a fresh database too; running it
against a database already stamped at this revision is a no-op.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0003_uuid7_and_sync_fields'
down_revision: str | None = '0002_add_task_statuses_and_subtasks'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('session') as batch_op:
        batch_op.add_column(sa.Column('timezone', sa.String(), nullable=False, server_default='UTC'))
        batch_op.add_column(sa.Column('external_sync_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('external_provider', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('extended_properties_json', sa.String(), nullable=False, server_default='{}'))
        batch_op.create_index('ix_session_external_sync_id', ['external_sync_id'])

    op.create_table(
        'externalsyncstate',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('account_id', sa.String(), nullable=False),
        sa.Column('sync_token', sa.String(), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_externalsyncstate_provider', 'externalsyncstate', ['provider'])
    op.create_index('ix_externalsyncstate_account_id', 'externalsyncstate', ['account_id'])


def downgrade() -> None:
    op.drop_index('ix_externalsyncstate_account_id', table_name='externalsyncstate')
    op.drop_index('ix_externalsyncstate_provider', table_name='externalsyncstate')
    op.drop_table('externalsyncstate')

    with op.batch_alter_table('session') as batch_op:
        batch_op.drop_index('ix_session_external_sync_id')
        batch_op.drop_column('extended_properties_json')
        batch_op.drop_column('external_provider')
        batch_op.drop_column('external_sync_id')
        batch_op.drop_column('timezone')
