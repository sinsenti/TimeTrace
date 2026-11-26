# TimeTrace

TimeTrace distinguishes performed work from future plans when comparing a task's estimate
with its time commitments.

## Language

**Task time breakdown**:
Comparison of a task's estimate with its logged time and scheduled time to show progress,
remaining estimated time and unscheduled estimated time. It uses saved sessions, not projected
recurring occurrences or time still on a running timer.

**Logged time**:
Time credited to sessions whose end is at or before the measurement instant.
It represents performed work rather than a future commitment.

**Scheduled time**:
Time committed to sessions whose start is after the measurement instant.
In the task time breakdown, it does not include projected recurring occurrences.

**Remaining estimated time**:
A task's estimated time minus its logged time; a negative balance means the estimate was exceeded.
An unbounded task has no finite balance.

**Unscheduled estimated time**:
A task's estimated time minus both its logged time and its scheduled time.
A negative balance is retained; an unbounded task has no finite balance.

**Unbounded task**:
A task with no positive finite work budget in the task time breakdown: a zero/missing estimate,
or a recurring task whose estimate describes an occurrence rather than the whole series.

## Agenda planning and recording

The following terms distinguish planned time from time explicitly saved as worked. They do not redefine the task time breakdown terms above.

**Task**:
An item of work that can have scheduled sessions and recorded intervals.

**Scheduled session**:
A time interval set aside for a task, which may overlap other scheduled sessions. Scheduling the interval does not mean that the work was done.
_Avoid_: Recorded interval, completed session

**Original plan**:
The first scheduled time interval for a scheduled session. It remains available for comparison after the current schedule changes.
_Avoid_: Current schedule, recorded time

**Current schedule**:
The scheduled time interval after any changes the user has accepted, including extensions.
_Avoid_: Original plan, recorded time

**Recorded interval**:
A saved span of time worked, captured with a timer or entered manually, with or without a task. Recorded intervals are separate from scheduled sessions and may overlap.
_Avoid_: Scheduled session, timer

**Timer**:
A way to track time as it happens, optionally for a task; stopping and saving it produces a recorded interval. Timers can run in parallel, but no task can have two running timers.

**Entry note**:
Text describing the activity tracked by a timer or saved in a recorded interval. It is separate from the task's description and a scheduled session's notes.
_Avoid_: Work note, timer note

**Recorded task time**:
The total time credited across tasks, counting each minute once per task. Two recorded intervals covering the same 20 minutes count as 20 minutes for one task or 40 minutes across two different tasks.
_Avoid_: Elapsed recorded time

**Elapsed recorded time**:
The total time covered by at least one recorded interval. Overlapping intervals count only once.
_Avoid_: Recorded task time

**Unassigned recorded interval**:
A recorded interval without an assigned task. It contributes to elapsed recorded time, but not recorded task time.

**Unassigned recorded time**:
The time covered by unassigned recorded intervals, counting overlapping minutes only once. It may overlap recorded task time and is not an additive remainder of elapsed recorded time.

**Link to a scheduled session**:
An explicit connection from a recorded interval to at most one scheduled session for the same task. Sharing a task or overlapping in time does not create the link.
_Avoid_: Inferred ownership

**Within schedule**:
The portion of a recorded interval for the same task that overlaps the original plan or current schedule, whichever the comparison names. For a 09:00–10:00 plan and a 09:50–10:20 recorded interval, 10 minutes are within the plan whether or not the interval is linked.

**Fit schedule to recorded intervals**:
An adjustment of the current schedule to span the earliest start and latest end of the recorded intervals explicitly linked to that session. The original plan and the recorded intervals remain unchanged.

**Timer inactivity gap**:
Time held out of a timer's tracked time because the computer appeared inactive, pending the user's review. Each paused timer's gap can be resolved separately.

**Agenda**:
A daily view of scheduled sessions and recorded intervals. It uses the same tasks, schedule, and timers as the calendar.
_Avoid_: Separate tracking system
