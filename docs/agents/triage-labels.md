# Triage labels

Map canonical roles to these local issue `Status:` strings.

| Canonical role | Local status | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate |
| `needs-info` | `needs-info` | Waiting for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for autonomous agent work |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill applies a triage label, update the issue's `Status:` line
using this mapping. Edit the Local status column to change vocabulary.
